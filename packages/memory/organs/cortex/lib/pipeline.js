// 皮层主流程：拉取 → 蒸馏 → 检索 → 注入 → 纠错。
// 编排层只做调度，具体逻辑在各自 lib 里（F01 四段管道的“联想/输出”段）。
import { makeConsolidator } from './consolidate.js'
import { searchByVector, blend } from './semantic.js'
import { search } from './match.js'
import { recall as recallConcepts, conceptList } from './concepts.js'
import { judge } from './judge.js'
import { edges, hierarchy, places } from './relations.js'
import { compose, combine } from './inject.js'
import { correct } from './correction.js'
import { list as listConflicts } from './conflicts.js'
import { FeedbackTracker } from './feedback.js'
import { capabilityReport } from './adapters.js'
import { canWrite } from './write-window.js'
import { read as readTraces, counts as traceCounts } from './traces.js'
import { writeMeta, appendJsonl, FILES } from './store.js'
import { cellKey } from './schema.js'
import { tierOf, restore as restoreCell } from './hot-cold.js'
import { record as recordConflict } from './conflicts.js'
import { classify } from './anti-pollution.js'
import { toCell } from './extract.js'
import { resolve as resolveConflictRow } from './conflicts.js'
import { log as auditLog } from './audit.js'
import { verifyWith } from './adapters/give-prefrontal.js'
import { rawOf } from './adapters/give-hippocampus.js'
import { traceConfidence } from './reconstruction.js'
import { tokenize } from './util.js'

/**
 * 该不该蒸：只看 distilled 记录 + 是否关段，不看时间水位。
 * 历史导入的事件时间早于 cursor，用 since 会被整批过滤掉。
 */
export function shouldDistill(ep, m = {}) {
  if (!ep || !ep.id) return false
  if (ep.state === 'open') return false
  return !m?.distilled?.[ep.id]
}

export function makeCortex({ store, adapters, meta, embedFn = null }) {  const consolidator = makeConsolidator({ store, adapters, meta })
  const feedback = new FeedbackTracker()
  let lastPullAt = 0
  let lastInjected = []

  /**
   * 该不该蒸：只看 distilled 记录 + 是否关段，不看时间水位。
   * 历史导入的事件时间早于 cursor，用 since 会被整批过滤掉。
   */
  async function pull({ limit = 500 } = {}) {
    // since 传 0：拉全量，靠 distilled 逐条去重；cursor 只做展示，不再当过滤条件
    const eps = await adapters.hippocampus.episodes({ since: 0, limit })
    lastPullAt = Date.now()
    return (Array.isArray(eps) ? eps : []).filter((e) => shouldDistill(e, meta))
  }

  async function distill({ mode = 'shallow', now = Date.now(), dryRun = false, episodes = null } = {}) {
    const eps = episodes || await pull()
    const out = await consolidator.run({ episodes: eps, mode, now, dryRun })
    // 游标只推进到“真正处理过的最后一条”，不能跳到拉取批的末尾，
    // 否则一次只处理 20 条时，剩下 180 条会被越过。
    if (!dryRun && out.processed && out.lastAt) {
      meta.cursor = Math.max(meta.cursor || 0, out.lastAt)
      await writeMeta(meta)
    }
    return out
  }

  /**
   * 按当前抽取规则重算全部存量：旧 cell 归档，清 distilled，重新蒸一遍。
   * fact 状态按 key 记住，重抽后补回去。
   */
  async function rebuild({ mode = 'deep' } = {}) {
    const factKeys = new Set(
      store.allCells()
        .filter((c) => c.state === 'fact' && !c.archived && !c.retracted)
        .map((c) => cellKey(c)),
    )
    for (const c of store.allCells()) {
      if (c.archived) continue
      c.archived = true
      store.put(c)
    }
    meta.distilled = {}
    meta.cursor = 0
    await writeMeta(meta)
    const out = await distill({ mode })
    let restored = 0
    for (const c of store.allCells()) {
      if (c.retracted) continue
      if (!factKeys.has(cellKey(c))) continue
      // 上面把所有 cell 都归档了；distill 若"没有新东西"就不会重建任何东西。
      // 恢复循环以前跳过 archived，于是事实还在库里（stats 数得到）却搜不到——
      // rebuild 报了 rebuilt:true，检索却是空的。这里先把它从归档里拿回来。
      if (c.archived) { c.archived = false; delete c.archivedAt; restored += 1 }
      if (c.state !== 'fact') { c.state = 'fact'; c.layer = 'semantic'; restored += 1 }
      store.put(c)
    }
    return { ...out, rebuilt: true, factsRestored: restored }
  }

  /**
   * 造一对矛盾数据，验证“冲突识别 + 记录”真的能跑。
   * 只用于自检：结束后两条 cell 归档、冲突标 test，不占 open 队列。
   */
  async function conflictProbe({ subject = '主人', predicate = '手机号', a = '13800138000', b = '13900139000' } = {}) {
    const A = toCell({ kind: 'fact', subject, predicate, object: a, text: `${subject}的${predicate}是${a}`, source: 'probe', state: 'fact' })
    const B = toCell({ kind: 'fact', subject, predicate, object: b, text: `${subject}的${predicate}是${b}`, source: 'probe', state: 'fact' })
    const kind = classify(B, A)
    store.put(A)
    store.put(B)
    let conflict = null
    if (kind === 'conflict') {
      conflict = await recordConflict(store, A, B, 'probe')
      conflict.state = 'test'
    }
    A.archived = true
    B.archived = true
    store.put(A)
    store.put(B)
    return { ok: kind === 'conflict', kind, aId: A.id, bId: B.id, conflict: Boolean(conflict) }
  }

  async function ask(query, { k = 5, mode = 'auto' } = {}) {
    // F36：意图由前额叶判；判不了就按规则分流
    let usedMode = mode
    if (!usedMode || usedMode === 'auto') {
      const plan = await adapters.prefrontal.plan(query)
      usedMode = plan?.mode || 'auto'
    }
    let { hits, mode: finalMode } = search(store.allCells(), query, { mode: usedMode, k })
    // 补全：直接命中太少时放宽门槛再捞一轮（人脑会给几条相近的）
    if (hits.length < 2) {
      const wide = search(store.allCells(), query, { mode: usedMode, k, floor: 0.4 })
      const seenIds = new Set(hits.map((h) => h.cellId))
      for (const h of wide.hits) if (!seenIds.has(h.cellId)) hits.push(h)
    }
    // 联想扩散：顺着图边把相邻 cell 也带出来，标记 associated/via
    const extra = []
    const seenCell = new Set(hits.map((h) => h.cellId))
    for (const h of hits.slice(0, 3)) {
      for (const e of store.graph) {
        const a = String(e.from)
        const b = String(e.to)
        if (!a.startsWith('c_') || !b.startsWith('c_')) continue
        let other = null
        if (a === h.cellId) other = b
        else if (b === h.cellId) other = a
        if (!other || seenCell.has(other)) continue
        const cell = store.get(other)
        if (!cell || cell.archived || cell.retracted) continue
        // 联想也要有点边：至少跟查询共享一个词，不然纯噪声
        const qt = new Set(tokenize(query))
        const ct = tokenize(cell.text)
        if (!ct.some((t) => qt.has(t))) continue
        seenCell.add(other)
        extra.push({
          cellId: cell.id,
          text: cell.text,
          kind: cell.kind,
          state: cell.state,
          source: cell.source || 'unknown',
          confidence: Number((cell.confidence || 0.4).toFixed(2)),
          score: 0.2,
          supportIds: cell.supportIds || [],
          associated: true,
          via: h.cellId,
          why: ['graph'],
        })
        if (extra.length >= k) break
      }
      if (extra.length >= k) break
    }
    hits = [...hits, ...extra]
    const now = Date.now()
    const annotated = hits.map((h) => {
      const cell = store.get(h.cellId)
      const confidence = cell ? Number(traceConfidence(cell, { confidence: 0.9 }).toFixed(2)) : h.confidence
      // F29：每次提取都留痕，记下当时的查询
      void appendJsonl(FILES.traces, { at: now, cellId: h.cellId, query, reconstructed: true, confidence })
      return {
        ...h,
        // 给前额叶 judge 用的最小字段（它按 episodeId/score/summary 判）
        id: h.cellId,
        episodeId: h.cellId,
        score: Number(h.score) || 1,
        summary: h.text,
        confidence,
        reconstructed: true,
      }
    })
    // F39：结果交前额叶校验
    const verified = await verifyWith(adapters, annotated)
    const accepted = Array.isArray(verified.accepted) ? verified.accepted : []
    // 前额叶只回 id/rank/confidence，text 得从原结果补回来，否则 answer 拼不出来
    const byId = new Map(annotated.map((h) => [h.episodeId || h.id, h]))
    const merged = accepted.map((a) => {
      const src = byId.get(a.episodeId || a.id) || {}
      return {
        ...src,
        ...a,
        cellId: a.cellId || src.cellId || a.id,
        text: a.text || src.text || src.summary || '',
      }
    })
    // 校验方把结果全拒了也不能让 ask 变空——退回未校验结果，标 verified:false
    const hits2 = merged.length ? merged : annotated
    // 同一句话只答一次；排序优先用前额叶给的 relevance/rankScore
    const seen = new Set()
    const unique = hits2
      .filter((h) => {
        const key = h.text || h.summary || h.id
        if (seen.has(key)) return false
        seen.add(key)
        return true
      })
      .sort((a, b) => {
        // 直接命中排在联想出来的前面
        const da = a.associated ? 1 : 0
        const db = b.associated ? 1 : 0
        if (da !== db) return da - db
        // 前额叶有时只给 rankScore，relevant 字段是 0；取两者最大，别被 0 盖掉
        const ra = Math.max(Number(a.relevance || 0), Number(a.rankScore || 0))
        const rb = Math.max(Number(b.relevance || 0), Number(b.rankScore || 0))
        return rb - ra || (b.score || 0) - (a.score || 0) || (b.confidence || 0) - (a.confidence || 0)
      })
    // 直接给一句能读的答案，别让调用方自己拼
    const answer = unique.slice(0, 3).map((h) => h.text || h.summary).filter(Boolean).join('；')
    return {
      query,
      mode: finalMode,
      hits: unique,
      answer,
      verified: Boolean(verified.verified && accepted.length),
    }
  }

  function inject({ budget = 800, now = Date.now() } = {}) {
    const seg = compose(store.allCells(), { budget, now })
    lastInjected = seg.ids
    feedback.record(seg.ids)
    return seg
  }

  async function observe(text) {
    const out = feedback.observe(text)
    // F04：被纠正的那几条当场降权、标证据不足，并留审计
    if (out.corrected?.length) {
      for (const id of out.corrected) {
        const cell = store.get(id)
        if (!cell) continue
        cell.evidenceFlag = true
        cell.confidence = Math.max(0.05, (cell.confidence || 0.5) * 0.8)
        store.put(cell)
      }
      await auditLog({ kind: 'feedback-corrected', ids: out.corrected, text: String(text).slice(0, 80) })
    }
    return out
  }

  function judgePair(aId, bId) {
    const a = store.get(aId)
    const b = store.get(bId)
    if (!a || !b) return { same: false, error: 'not-found' }
    return judge(a, b)
  }

  async function correction(id, reason) {
    return correct(store, id, { reason })
  }

  function resolveConflict(index, winner = 'neither') {
    return resolveConflictRow(store, index, winner)
  }

  function restore(id) {
    const cell = store.get(id)
    if (!cell) return null
    restoreCell(cell)
    store.put(cell)
    return { id, restored: true, tier: cell.tier }
  }

  async function traceStats() {
    const rows = await readTraces(adapters, { since: 0 })
    const counts = traceCounts(rows, store.allCells())
    return { rows: rows.length, cells: counts.size }
  }

  function stats() {
    const cells = store.allCells()
    return {
      ...store.stats(),
      conflicts: store.conflicts.filter((c) => c.state === 'open').length,
      tiers: { hot: cells.filter((c) => tierOf(c) === 'hot').length, cold: cells.filter((c) => tierOf(c) === 'cold').length },
      cursor: meta.cursor || 0,
      lastDistillAt: meta.lastDistillAt || 0,
      capabilities: capabilityReport(adapters),
      concepts: conceptList(cells, 10),
    }
  }

  // ── 给前额叶的同步面（它用 callSync，返回 Promise 会被当成普通值）──
  function conceptsSync(query, k = 5) {
    const q = String(query || '').trim()
    // 空查询 = 要"清单"，不是要"检索"。
    // 仪表页就是这么调的（concepts('', 20)），以前走 recallConcepts 会因为没关键词而返回空，
    // 于是页面上"皮层事实"永远是 0，而库里其实有上百条。
    if (!q) {
      const cells = store.allCells().filter((c) => c && !c.retracted)
      const rank = (c) => {
        if (c.state === 'fact') return 0
        if (c.kind === 'concept' || c.level === 'rule') return 1
        if (c.kind === 'preference' || c.kind === 'trait') return 2
        return 3
      }
      const items = cells
        .slice()
        .sort((a, b) => rank(a) - rank(b) || (Number(b.lastSeen) || 0) - (Number(a.lastSeen) || 0))
        .slice(0, k)
        .map((c) => ({
          id: c.id,
          text: c.text,
          predicate: c.predicate,
          kind: c.kind,
          confidence: c.confidence,
          at: c.lastSeen || c.firstSeen || 0,
        }))
      return { query: '', items, total: cells.length }
    }
    return recallConcepts(store.allCells(), q, { k })
  }

  function searchSync(query, { mode = 'auto', k = 5 } = {}) {
    return search(store.allCells(), query, { mode, k })
  }

  /**
   * 双模式检索：关键词（别名扩写/精确）出候选，再用向量补语义相近的。
   * 没有 embedFn、或向量还没建时，行为与 searchSync 一致（安静降级）。
   */
  async function searchAsync(query, { mode = 'auto', k = 5, vectorWeight = 0.35 } = {}) {
    if (!embedFn) return searchSync(query, { mode, k })
    const base = searchSync(query, { mode, k: Math.max(k * 4, 20) })
    let vecHits = []
    try {
      vecHits = await searchByVector(query, store.allCells(), { embedFn, k: Math.max(k * 4, 20) })
    } catch {
      vecHits = []
    }
    if (!vecHits.length) return searchSync(query, { mode, k })
    const merged = blend(base.hits || [], vecHits, { weight: vectorWeight }).slice(0, k)
    return { ...base, hits: merged, vectorUsed: true, vectorHits: vecHits.length }
  }

  function contradictsSync(a, b) {
    const A = typeof a === 'string' ? store.get(a) : a
    const B = typeof b === 'string' ? store.get(b) : b
    if (!A || !B) return { verdict: 'unknown', confidence: 0, why: 'missing-cell' }
    // 先查"同主语同谓词不同值"这条硬规矩：以前先问 judge，而 judge 会因为
    // 两句话只差一个数字就判 same，于是这条分支永远走不到——
    // 两个手机号会被报成"一致"，而 upsert 那边明明记了冲突。
    const sameKey = A.subject === B.subject && A.predicate === B.predicate && A.object !== B.object
    if (sameKey) return { verdict: 'contradict', confidence: 0.8, why: 'same-subject-predicate-different-object' }
    const j = judge(A, B)
    if (j.same) return { verdict: 'consistent', confidence: j.confidence, why: 'same-cell' }
    return { verdict: 'unknown', confidence: 0.2, why: 'not-comparable' }
  }

  function summarizeSync(items = []) {
    const list = Array.isArray(items) ? items : (items ? [items] : [])
    const ids = list.map((x) => (typeof x === 'string' ? x : x?.id || x?.episodeId)).filter(Boolean)
    const cells = ids.map((id) => store.get(id)).filter(Boolean)
    if (!cells.length) return { text: '', ids: [], why: 'no-cells' }
    const text = cells.slice(0, 5).map((c) => c.text).filter(Boolean).join('；').slice(0, 240)
    return { text, ids: cells.map((c) => c.id), why: 'cortex-labels' }
  }

  /**
   * E5/E8：cell → episode 映射。
   * 海马体拿到的是 cellId，图里是 e: 前缀；没有这张映射，两套 id 会搅在一起。
   */
  function anchorsOf(cellId) {
    const c = store.get(String(cellId || ''))
    if (!c) return { id: String(cellId || ''), supportIds: [], anchors: [], episodes: [] }
    const supportIds = [...new Set(c.supportIds || [])]
    const anchors = [...new Set(c.anchors || [])]
    return {
      id: c.id,
      supportIds,
      anchors,
      episodes: [...new Set([...supportIds, ...anchors])],
    }
  }

  function health() {
    const cells = store.allCells()
    return {
      ok: cells.length >= 0,
      level: capabilityReport(adapters).level,
      source: adapters.hippocampus.mode || 'unknown',
      vectorReady: Boolean(adapters.hippocampus.vectorReady),
      cells: cells.length,
      facts: cells.filter((c) => c.state === 'fact').length,
      hypotheses: cells.filter((c) => c.state === 'hypothesis').length,
      conflicts: store.conflicts.filter((c) => c.state === 'open').length,
      canWrite: canWrite({ lastActivityAt: meta.cursor || 0 }),
      lastPullAt,
      lastInjected: lastInjected.length,
    }
  }

  return {
    store,
    adapters,
    meta,
    pull,
    distill,
    ask,
    inject,
    observe,
    judgePair,
    correction,
    resolveConflict,
    restore,
    traceStats,
    stats,
    health,
    rebuild,
    conflictProbe,
    conceptRecall: (q, k) => recallConcepts(store.allCells(), q, { k }),
    conceptsSync,
    searchSync,
    searchAsync,
    contradictsSync,
    summarizeSync,
    anchorsOf,
    edgesOf: (id) => edges(store, id),
    hierarchy: () => hierarchy(store.allCells()),
    places: () => places(store.allCells()),
    conflicts: () => listConflicts(store, 50).filter((c) => c.state === 'open'),
    rawOf: (episodeId) => rawOf(adapters, episodeId),
    injectCombined: (hippocampusText, budget) => combine({ cortex: compose(store.allCells()).text, hippocampus: hippocampusText, budget }),
  }
}
