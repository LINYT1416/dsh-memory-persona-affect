// 巩固：重放、反向、拼接、显著性调制、锁存、审计。
// 对应功能总表：L4-1 正向重放、L4-2 反向重放、L4-3 拼接、L4-4 显著性调制、L4-5 回传、
// L4-6 时机窗口、L4-7 两种巩固、L4-8 次数→强度、L4-9 theta 预演、L4-10 锁存、L4-11 压缩比、
// L4-13 三输出口、L4-14 结果信号、L4-15 拼接裁决、C9 可审计。

import { appendJsonl, readJsonl, FILES, readRawDays } from './store.js'
import { detectResult, keywords } from './taxonomy.js'
import { decayedAccessibility, effectiveScore } from './decay.js'
import { toEpisodeSnapshot } from './adapters.js'
import { clipText } from './encode.js'
import { orderForConsolidation, corroborate } from './priority.js'
import { buildCausalFromParts } from './causal.js'

const BATCH = 20 // L4-11 压缩比：默认一批 20 条

/**
 * @param {object} args
 * @param {object} args.store 内存态
 * @param {object} args.adapters 三器官桩
 * @param {object} args.layers 分层开关
 */
/**
 * 该不该现在巩固。
 * 以前 tick 里只有一条：必须安静 30 分钟才跑 —— 结果只要一直在聊天，积压永远清不掉，
 * 皮层就永远拿不到新事实（表现成"皮层没记忆"）。
 * 现在三条任一成立就跑：真的安静了 / 积压够多 / 离上次超过 20 分钟且还有活。
 */
export function shouldRunNow({ pending = 0, lastConsolidateAt = 0, now = Date.now(), quiet = false } = {}) {
  if (pending <= 0) return false
  if (quiet) return true
  if (pending >= 8) return true
  if (now - Number(lastConsolidateAt || 0) > 20 * 60 * 1000) return true
  return false
}

export function makeConsolidator({ store, adapters, layers }) {
  const log = []

  function quiet(now, minutes = 30) {
    // L4-6：安静期 = 连续 N 分钟无新写入
    const latest = Math.max(0, ...store.allEpisodes().map((e) => Number(e.updatedAt || e.end || 0)))
    return now - latest >= minutes * 60 * 1000
  }

  /** 一次巩固 = 一批 closed episode。deep 模式处理更多、可跑拼接。 */
  async function run({ mode = 'shallow', now = Date.now() } = {}) {
    if (layers?.isOff('consolidate')) return { skipped: 'layer-off' }

    if (mode === 'deep') {
      // 巩固前先关掉空闲段：皮层只蒸 closed 的，不关段就死锁
      for (const ep of store.allEpisodes()) {
        if (ep.state !== 'open' || ep.test) continue
        if (now - Number(ep.end || ep.start) < 60 * 1000) continue
        ep.state = 'closed'
        ep.closedAt = now
        ep.version += 1
        store.touch(ep)
        store.openBySession.delete(ep.anchor.sessionId)
        await appendJsonl(FILES.episodes, ep)
      }
    }
    // 选批：先按重要度（显著 · 新近 · 实体热度 · 置信度）挑人，再按时间排好重放。
    // 以前只按 start 升序取前 N 条，等于"先来的先巩固"，重要的一直排在队尾。
    const closedPool = store.allEpisodes().filter((e) => e.state === 'closed' && !e.test)
    const pending = orderForConsolidation(closedPool, {
      now,
      limit: mode === 'deep' ? BATCH * 2 : BATCH,
      allEpisodes: store.allEpisodes(),
    })

    if (!pending.length) return { processed: 0, mode }

    const results = []
    const candidates = []

    for (const ep of pending) {
      // L4-1 正向重放：按时间顺序重读
      const raws = await readEpisodeRaw(ep)
      const joined = raws.map((r) => r.text).join(' ')

      // 因果/转折/结果：输入扩到"同一会话里最近几条原始消息"（你同意过的口径）。
      // 仍然不跨会话、不跨段，只把一次对话里的前后几轮串起来 —— 因为一个字半个因果，
      // "因为…"常在我这边，"所以…"常常下一句才出现。
      // 标注的仍是"话里说了关系"，不是"世界上真存在因果"。
      const windowEps = store
        .sessionEpisodes(ep.anchor.sessionId)
        .filter((x) => x.id !== ep.id && x.end <= ep.start && ep.start - x.start <= 30 * 60 * 1000)
        .slice(-3)
      const causalParts = []
      for (const w of windowEps) {
        const rs = await readEpisodeRaw(w)
        for (const r of rs) if (r.text) causalParts.push(r.text)
      }
      causalParts.push(joined)
      const causal = buildCausalFromParts(causalParts)
      if (causal.length) {
        ep.causal = causal
        ep.causalWindow = [...windowEps.map((x) => x.id), ep.id]
      }

      // L4-4 显著性调制：重要的多播一遍（这里体现为多抽一轮候选）
      const rounds = ep.salience >= 0.65 ? 2 : 1
      const facts = []
      // 皮层要的是 episode 快照（summary/text/rawTexts/role/start），不是内存对象
      const snapshot = toEpisodeSnapshot(ep, raws.map((r) => r.text))
      for (let i = 0; i < rounds; i++) {
        const got = adapters?.cortex?.extract
          ? await safe(() => adapters.cortex.extract(snapshot), null, 400)
          : extractCandidates(ep, joined)
        if (got) facts.push(...(Array.isArray(got) ? got : [got]))
      }

      // L4-2 反向重放：有结果信号才跑（L4-14）
      let reversed = null
      if (detectResult(joined)) {
        const prior = store.sessionEpisodes(ep.anchor.sessionId)
          .filter((x) => x.end <= ep.start)
          .slice(-5)
        reversed = { from: ep.id, prior: prior.map((p) => p.id), why: 'result-signal' }
        for (const p of prior) {
          p.replayBoost = Math.min(1.5, (p.replayBoost || 1) * 1.2)
          store.touch(p)
        }
      }

      // L4-3 拼接：同实体、不同 episode（L4-15 只产候选，不自动合并）
      let stitched = null
      if (mode === 'deep') {
        const peers = store.allEpisodes().filter((x) => x.id !== ep.id
          && x.entities.some((e) => ep.entities.includes(e))
          && Math.abs(x.start - ep.start) > 60 * 60 * 1000)
        if (peers.length) stitched = { with: peers.slice(0, 3).map((p) => p.id), kind: 'possible-same' }
      }

      // E6 冲突显式化：同实体、各有不同的长数字 → 标冲突（标记，不覆盖）
      const conflicts = detectConflicts(store, ep)

      // 冲突显式化：标出来、留 id，不覆盖。裁决仍在皮层做（cortex_conflicts），
      // 但海马体这一侧也要能直接看出"这条记忆跟谁打架"，不用去翻皮层。
      if (conflicts.length) {
        ep.conflicts = conflicts
        ep.conflictCount = conflicts.length
      }

      // E8 语义边：皮层给 cell 之间的边，用 anchorsOf 落回 episode，进图
      let semanticEdges = 0
      if (mode === 'deep' && adapters?.cortex?.concepts && adapters?.cortex?.anchorsOf && adapters?.cortex?.relations) {
        try {
          const c = adapters.cortex.concepts(ep.summary, 5)
          for (const item of c?.items || []) {
            const edges = await adapters.cortex.relations(item.id)
            for (const e of edges || []) {
              const a = adapters.cortex.anchorsOf(e.from)
              const b = adapters.cortex.anchorsOf(e.to)
              for (const x of a?.episodes || []) {
                for (const y of b?.episodes || []) {
                  if (x === y) continue
                  store.addNode(`c:${item.id}`, 'concept', item.text || item.id)
                  // c: 和 e: 两套 id 不混：概念节点只跟事件节点连一条 about，事件之间连 semantic
                  store.addEdge(`e:${x}`, `c:${item.id}`, 'about', 0.6)
                  store.addEdge(`e:${x}`, `e:${y}`, 'semantic', e.w || 0.5)
                  semanticEdges += 1
                }
              }
            }
          }
        } catch { /* 皮层没准备好就跳过这轮 */ }
      }

      // 互证（配合计算式置信度）：后来的记忆提到同样的人和事，
      // 说明前面那条不是孤证 —— 给它涨一点，涨到 0.95 封顶，涨多少留痕。
      const corr = corroborate(ep, store.sessionEpisodes(ep.anchor.sessionId).filter((x) => x.id !== ep.id && x.start <= ep.start))
      for (const m of corr.matched) {
        const target = store.allEpisodes().find((x) => x.id === m.id)
        if (!target) continue
        if (!Number.isFinite(Number(target.confidenceBase))) target.confidenceBase = Number(target.confidence)
        target.confidence = m.after
        target.corroboratedBy = [...new Set([...(target.corroboratedBy || []), ep.id])].slice(-5)
        target.version += 1
        store.touch(target)
        await appendJsonl(FILES.episodes, target)
      }

      const entry = {
        at: now,
        episodeId: ep.id,
        mode,
        facts: facts.slice(0, 4),
        conflicts,
        semanticEdges,
        reversed,
        stitched,
        rounds,
        corroborated: corr?.matched?.length || 0,
        causal: causal.length,
      }
      results.push(entry)
      if (facts.length) candidates.push({ at: now, episodeId: ep.id, facts: facts.slice(0, 4), state: 'pending' })
      if (conflicts.length) candidates.push({ at: now, episodeId: ep.id, kind: 'conflict', conflicts, state: 'pending' })

      // L4-10 锁存落盘：状态当场改
      ep.state = 'consolidated'
      ep.consolidatedAt = now
      ep.version += 1
      ep.replayBoost = Math.max(1, ep.replayBoost || 1)

      // L4-12 索引退场：巩固完先降一档（held → shadowed）；
      // retired 必须等 E15 的接管信号，不能自己退。
      if (adapters?.cortex?.handoff) {
        const ok = await safe(() => adapters.cortex.handoff(ep.id), null, 120)
        ep.transferState = ok ? 'retired' : 'shadowed'
      } else if (ep.transferState === 'held') {
        ep.transferState = 'shadowed'
      }
      store.touch(ep)
      // 状态变了也写一行新版本（append-only，读的时候取最大 version）
      await appendJsonl(FILES.episodes, ep)
    }

    // L4-5 回传：把事实候选发给皮层。皮层要的是 subject/predicate/object 的扁平数组，
    // 不是 {episodeId, facts} 的包装。
    const flat = results.flatMap((r) => r.facts || []).filter((f) => f && f.subject && f.object)
    let uploaded = null
    if (adapters?.cortex?.upsert && flat.length) {
      uploaded = await safe(() => adapters.cortex.upsert(flat), null, 600)
    }
    if (candidates.length) await appendJsonlMulti(FILES.candidates, candidates)

    // L4-9 theta 预演：用最近 N 条话题预测下一个话题（单器官只展示）
    const prediction = predictNextTopic()

    // L2-10 话题朝向：把预测写回最近一条，给下次检索/注入当方向
    if (prediction) {
      const recent = store.allEpisodes().slice(-1)[0]
      if (recent) {
        recent.topicDirection = prediction.expect
        store.touch(recent)
      }
    }

    // L4-13 三输出口：结果/教材/情境分开交
    const outputs = {
      toPrefrontal: results.map((r) => ({ episodeId: r.episodeId, facts: r.facts })),
      toCortex: { candidates, uploaded },
      toPlanner: prediction ? [prediction] : [],
    }

    // C9 可审计
    await appendJsonl(FILES.consolidation, {
      at: now,
      mode,
      processed: results.length,
      candidates: candidates.length,
      prediction,
    })
    log.push({ at: now, mode, processed: results.length })

    return { processed: results.length, candidates: candidates.length, prediction, outputs, mode }
  }

  /** L4-9：下一个话题的纯统计预测。 */
  function predictNextTopic() {
    const recent = store.allEpisodes().slice(-10)
    if (recent.length < 3) return null
    const freq = new Map()
    for (const ep of recent) {
      for (const k of ep.keywords || []) freq.set(k, (freq.get(k) || 0) + 1)
    }
    const top = [...freq.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([w]) => w)
    return top.length ? { at: Date.now(), expect: top, basis: recent.length } : null
  }

  /** 衰减扫描：把过期的标 archived（L5-1），不删。 */
  async function sweep(now = Date.now()) {
    if (layers?.isOff('forget')) return { swept: 0 }
    let swept = 0
    for (const ep of store.allEpisodes()) {
      if (ep.state === 'archived') continue
      const score = effectiveScore(ep, { now, replayBoost: ep.replayBoost || 1 })
      ep.accessibility = score
      if (score < 0.04) {
        ep.state = 'archived'
        ep.archivedAt = now
        swept += 1
      }
      store.touch(ep)
    }
    return { swept }
  }

  async function readEpisodeRaw(ep) {
    const all = await readRawDays(0)
    const ids = new Set(ep.rawIds || [])
    return all.filter((r) => ids.has(r.id)).sort((a, b) => a.at - b.at)
  }

  function stats() {
    return { pending: store.allEpisodes().filter((e) => e.state === 'closed').length, log: log.slice(-10) }
  }

  return { run, quiet, sweep, stats, predictNextTopic }
}

/** E6：同会话、共享实体、各有不同长数字 → 判定为冲突候选。 */
function detectConflicts(store, ep) {
  const mine = String(ep.summary || '').match(/\d{6,}/g) || []
  if (!mine.length) return []
  const out = []
  for (const other of store.sessionEpisodes(ep.anchor.sessionId)) {
    if (other.id === ep.id) continue
    const shared = (other.entities || []).filter((e) => ep.entities.includes(e)).length
    if (shared < 1) continue
    const theirs = String(other.summary || '').match(/\d{6,}/g) || []
    if (!theirs.length) continue
    if (mine.some((n) => theirs.includes(n))) continue
    out.push({ with: other.id, shared, mine: mine[0], theirs: theirs[0] })
    store.addEdge(`e:${ep.id}`, `e:${other.id}`, 'conflict', 0.5)
    if (out.length >= 3) break
  }
  return out
}

/** 规则抽取候选（皮层不在时的默认实现，E4 桩）。
 *  字段跟皮层对齐：subject/predicate/object，这样有皮层时两边能直接互换。 */
function extractCandidates(ep, joined) {
  const out = []
  const text = String(joined || '')
  // 事实候选：带账号/号码/名字/偏好的句子
  const sentences = text.split(/[。！？；\n]+/).map((s) => s.trim()).filter((s) => s.length >= 4)
  for (const s of sentences) {
    if (!/uid|账号|号码|名字|叫|喜欢|讨厌|住|生日|过敏/.test(s)) continue
    out.push({
      kind: 'fact',
      subject: '主人',
      predicate: '事实',
      object: clipText(s, 60),
      text: clipText(s, 120),
      confidence: 0.6,
      source: 'stated',
    })
  }
  // 关系候选：人名词
  const people = (ep.entities || []).filter((e) => /爸|妈|哥|姐|弟|妹|老师|同事|朋友|室友/.test(e))
  for (const p of people) {
    out.push({
      kind: 'relation',
      subject: '主人',
      predicate: '关系',
      object: p,
      text: String(p),
      confidence: 0.5,
      source: 'stated',
    })
  }
  return out
}

async function appendJsonlMulti(file, rows) {
  for (const row of rows) await appendJsonl(file, row)
}

async function safe(fn, fallback, timeoutMs = 300) {
  try {
    const p = Promise.resolve().then(fn)
    const t = new Promise((resolve) => setTimeout(() => resolve(fallback), timeoutMs))
    return await Promise.race([p, t])
  } catch {
    return fallback
  }
}
