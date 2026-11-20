import fs from 'node:fs'
// 检索：双模式 + 图扩散 + 抑制 + 序列查询 + 原始层兜底。
// 对应功能总表：L3-1 补全、L3-2 双模式、L3-3 扩散、L3-4 抑制、L3-7 复述vs本体、L3-8 低覆盖、
// L3-9 同步召回、L3-11 读侧旁路、L3-12 序列查询、L3-13 兜底、L2-5 痕迹、L2-9 召回理由、R3 抑制粒度。

import { readJsonl, appendJsonl, FILES, readRawDays } from './store.js'
import { appendFileSync } from 'node:fs'

/** 临时调试：把召回出口的真实数据写盘，别再靠推理。 */
function dbg(o) { try { appendFileSync(DATA_DIR + '/_recall-debug.log', JSON.stringify(o) + '\n') } catch {} }
import { makeBm25, exactHits } from './search-bm25.js'
import { embed, cosine, coverage } from './vectors.js'
import { timeGradient } from './decay.js'
import { isTestText, extractEntities, tokenize } from './taxonomy.js'

const RRF_K = 60

function rrf(lists) {
  const acc = new Map()
  for (const list of lists) {
    list.forEach((hit, rank) => {
      const cur = acc.get(hit.id) || { id: hit.id, score: 0, hits: 0, why: [] }
      cur.score += 1 / (RRF_K + rank + 1)
      cur.hits += 1
      if (hit.why) cur.why.push(hit.why)
      acc.set(hit.id, cur)
    })
  }
  for (const x of acc.values()) if (x.hits > 1) x.score += 0.02
  return [...acc.values()].sort((a, b) => b.score - a.score)
}

/**
 * 加权 RRF：每路给一个权重，路内按该路最高分归一化。
 * 长查询拆成多路时，用这个——高区分度的词（住院）权重才压得过
 * 泛词（出事/事件）堆出来的票数。
 */
function weightedRrf(entries) {
  const acc = new Map()
  for (const { list, w = 1 } of entries) {
    if (!list?.length) continue
    const max = Number(list[0]?.score) || 1
    list.forEach((hit, rank) => {
      const cur = acc.get(hit.id) || { id: hit.id, score: 0, hits: 0, why: [] }
      const rel = 0.4 + 0.6 * Math.min(1, (Number(hit.score) || 0) / max)
      cur.score += w * (1 / (RRF_K + rank + 1)) * rel
      cur.hits += 1
      if (hit.why) cur.why.push(hit.why)
      acc.set(hit.id, cur)
    })
  }
  for (const x of acc.values()) if (x.hits > 1) x.score += 0.02
  return [...acc.values()].sort((a, b) => b.score - a.score)
}

/**
 * 把查询拆成实词：先按空白/标点切，长句再抽实体。
 * 一个词一路召回，比把 10 个词拼成一句交给 BM25 强——后者会稀释。
 */
function splitTerms(query, limit = 6) {
  const text = String(query || '')
  const parts = text
    .split(/[\s,，、;；|/]+/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 2)
  const out = new Set()
  for (const p of parts) {
    if (p.length <= 6) out.add(p)
    // 短句也要抽实体：否则“我爸住院了”这种就是单路，还是被多词覆盖的那条压住
    for (const e of extractEntities(p, 4)) out.add(e)
    if (out.size >= limit) break
  }
  if (out.size <= 1) {
    for (const e of extractEntities(text, limit)) out.add(e)
  }
  return [...out].slice(0, limit)
}

/**
 * 作废的 episode 不许出现在召回里（可单测的纯函数）。
 * index.jsonl 是 append-only，标了 retracted 之后旧索引行还在，
 * 所以每次读索引快照都要按 store 的最新状态过一遍。
 */
export function filterRetracted(rows = [], getEp = () => null) {
  return rows.filter((r) => {
    const id = r.episodeId || r.id
    let ep = null
    try { ep = getEp(id) } catch { ep = null }
    return !ep || ep.state !== 'retracted'
  })
}

export function makeRecall({ store, adapters }) {
  let rowsCache = null
  let rowsStale = false // 写路径改了索引：标脏，但不丢旧缓存
  let bm25 = null
  let vecCache = new Map() // episodeId → vector|null

  async function rows() {
    if (rowsCache && !rowsStale) return rowsCache
    const raw = await readJsonl(FILES.index)
    // 作废的 episode 必须立刻退出索引快照：index.jsonl 是 append-only，
    // 光在 episodes 里标 retracted 不够，召回仍会命中旧的行（实测 3 条垃圾记忆
    // 还在 index 里躺着）。这里按 store 里的最新状态过一遍。
    rowsCache = filterRetracted(raw, (id) => (store.get ? store.get(id) : null))
    rowsStale = false
    return rowsCache
  }

  async function index() {
    const r = await rows()
    if (!bm25 || bm25.rows !== r) bm25 = makeBm25(r)
    return bm25
  }

  /**
   * 写路径改了索引行：标脏，不置 null。
   * 置 null 的话，写完立刻同步召回（心情插件同拍就是这么调的）会撞上
   * index-not-loaded 直接降级——宁可给一份稍旧的索引，也别让“想不起来”。
   */
  function invalidate() {
    rowsStale = true
    bm25 = null
    // 后台悄悄补一份新的，同步路径继续用旧的那份
    void rows().catch(() => {})
  }

  /** 新 episode 写进来后补一条向量，让补全模式立刻能用上（不必等全量预热）。 */
  async function warmVectorFor(episodeId) {
    const r = await rows()
    const row = r.find((x) => x.episodeId === episodeId)
    if (!row) return null
    if (vecCache.has(episodeId)) return vecCache.get(episodeId)
    const vec = await embed(row.summary || '')
    vecCache.set(episodeId, vec)
    return vec
  }

  /** 图扩散：从命中的 episode 节点走 1 跳，找别的 episode（L3-3）。 */
  // 序列表征：episode 在巩固时记下了 causalWindow（前后因果窗口），
// 但以前只写不读——检索完全不知道因果链的存在。这里让它参与扩散。
function causalSpread(episodeIds, { max = 6 } = {}) {
  const out = new Map()
  for (const id of episodeIds) {
    const ep = store.get(id)
    const win = Array.isArray(ep?.causalWindow) ? ep.causalWindow : []
    for (const n of win) {
      if (!n || n === id) continue
      const prev = out.get(n) || 0
      if (0.5 > prev) out.set(n, 0.5)
      if (out.size >= max) break
    }
    if (out.size >= max) break
  }
  return [...out.entries()].map(([eid, score]) => ({ id: eid, score, why: 'causal' }))
}

function spread(episodeIds, hops = 1) {
    const out = new Map()
    for (const id of episodeIds) {
      const near = store.neighbors(`e:${id}`, hops)
      for (const nodeId of near) {
        if (!nodeId.startsWith('e:')) continue
        const other = nodeId.slice(2)
        if (other === id) continue
        out.set(other, (out.get(other) || 0) + 1)
      }
    }
    return [...out.entries()].map(([id, w]) => ({ id, score: w, why: 'graph' }))
  }

  /** 抑制：episode 粒度去重（R3），同会话 20 分钟内只留最高分那条。 */
  function inhibit(list) {
    const picked = []
    const seen = new Set()
    for (const hit of list) {
      if (seen.has(hit.id)) continue
      seen.add(hit.id)
      const ep = store.get(hit.id)
      if (!ep) continue
      const dup = picked.find((p) => {
        const other = store.get(p.id)
        return other && other.anchor.sessionId === ep.anchor.sessionId && Math.abs(other.start - ep.start) < 20 * 60 * 1000
      })
      if (dup) continue
      picked.push(hit)
    }
    return picked
  }

  /** L2-13 多线索归并：同一条 episode 被多路命中，合成一条，why 里保留所有来源。 */
  function mergeByEpisode(list) {
    const map = new Map()
    for (const hit of list) {
      const cur = map.get(hit.id)
      if (!cur) {
        map.set(hit.id, { ...hit, why: [...(hit.why || [])] })
      } else {
        cur.score += hit.score * 0.5
        cur.hits = (cur.hits || 0) + 1
        for (const w of hit.why || []) if (!cur.why.includes(w)) cur.why.push(w)
      }
    }
    return [...map.values()].sort((a, b) => b.score - a.score)
  }

  /** L3-7 复述 vs 本体：被 similar 边连着的两条，较新的标成复述。 */
  function markRestatements(items) {
    const ids = new Set(items.map((x) => x.episodeId))
    const newer = new Map()
    if (items.length < 2) return items
    for (const edge of store.graph.edges) {
      if (edge.kind !== 'similar') continue
      const a = edge.from?.startsWith('e:') ? edge.from.slice(2) : null
      const b = edge.to?.startsWith('e:') ? edge.to.slice(2) : null
      if (!a || !b || !ids.has(a) || !ids.has(b)) continue
      const ea = store.get(a)
      const eb = store.get(b)
      if (!ea || !eb) continue
      const [body, restate] = ea.start <= eb.start ? [a, b] : [b, a]
      newer.set(restate, body)
    }
    for (const item of items) {
      const bodyId = newer.get(item.episodeId)
      if (bodyId) {
        item.isRestatement = true
        item.restatementsOf = [bodyId]
      }
    }
    return items
  }

  /** L3-5 未来素材包：只抽槽位，不生成句子。 */
  function buildMaterial(items) {
    const entities = new Set()
    const actions = new Set()
    const places = new Set()
    const types = new Set()
    for (const item of items) {
      for (const e of item.entities || []) entities.add(e)
      for (const a of item.slots?.action || []) actions.add(a)
      if (item.place) places.add(item.place)
      if (item.type) types.add(item.type)
    }
    return {
      entities: [...entities].slice(0, 8),
      actions: [...actions].slice(0, 8),
      places: [...places].slice(0, 4),
      types: [...types].slice(0, 4),
      slots: ['谁', '做了什么', '在哪', '结果'],
      note: '素材而已，推演由生成端做',
    }
  }

  /** 一条命中 → 可读结果（L3-9 整段给，不拆散）。 */
  function shape(hit, extra = {}) {
    const ep = store.get(hit.id)
    if (!ep) return null
    return {
      episodeId: ep.id,
      session: ep.anchor.sessionId,
      at: ep.start,
      atText: new Date(ep.start).toLocaleString('zh-CN', { hour12: false }),
      summary: ep.summary,
      slots: ep.slots,
      entities: ep.entities,
      place: ep.place,
      type: ep.type,
      // 来源监控：谁说的、哪个通道、多可信（人脑记得是亲眼见的还是听说的）
      source: {
        kind: ep.anchor?.channel || 'dsh',
        channel: ep.anchor?.channel || 'dsh',
        msgId: ep.anchor?.msgId || '',
        trust: Number(ep.confidence ?? 0.7),
        at: ep.start,
      },
      rawIds: ep.rawIds,
      rawCount: (ep.rawIds || []).length,
      state: ep.state,
    // 退场状态必须带出去：前额叶要靠它给 retired/shadowed 降权。
    // 以前只给 state（consolidated/open），transferState 被吞掉，
    // 于是"退场索引降权"在线上一条都降不到——查了才知道。
    transferState: ep.transferState,
      confidence: ep.confidence,
      dangling: Boolean(ep.dangling?.length),   // L2-14 悬空就标出来，不静默
      isRestatement: false,                     // L3-7 默认本体，复述在下面标
      restatementsOf: [],
      score: Number((hit.score || 0).toFixed(4)),
      why: [...new Set(hit.why || [])].join('+') || 'unknown',
      ...extra,
    }
  }

  /** 分离模式：精确命中 + 过滤，不走向量（L3-2/L3-11）。 */
  async function separate(query, opts) {
    const r = await rows()
    let hits = exactHits(r, query)
    if (opts.type) hits = hits.filter((h) => store.get(h.id)?.type === opts.type)
    return hits
  }

  /** 补全模式：整串 + 拆词多路 + 向量 + 图扩散，加权 RRF（L3-1）。 */
  async function complete(query, opts) {
    const idx = await index()
    const r = await rows()
    const qs = String(query || '')
    const bm = idx.search(qs, 30)

    // 长查询交给 BM25 会被稀释：上游把扩写拼成一长串时，
    // 拆成实词一个词一路，整串那路降权，高区分度的词才拿得到自己的票。
    const terms = splitTerms(qs)
    const entries = [{ list: bm, w: terms.length > 1 ? 0.6 : 1 }]
    for (const t of terms) entries.push({ list: idx.search(t, 8), w: 1 })

    // 向量路：只算已经缓存的，缺就跳过（不拿哈希冒充）
    // 阈值 0.30：低于这个的余弦基本是“沾点边”，放进来只会抢座次
    const VEC_MIN = Number(process.env.HIPPO_VEC_MIN ?? 0.30)
    const qv = await embed(query)
    let vecHits = []
    if (qv) {
      vecHits = []
      for (const row of r) {
        if (!vecCache.has(row.episodeId)) continue
        const v = vecCache.get(row.episodeId)
        if (!v) continue
        const score = cosine(qv, v)
        if (score >= VEC_MIN) vecHits.push({ id: row.episodeId, score, why: 'vector' })
      }
      vecHits.sort((a, b) => b.score - a.score)
      vecHits = vecHits.slice(0, 30)
    }
    entries.push({ list: vecHits, w: 1.2 })

    const graphHits = spread(bm.slice(0, 3).map((h) => h.id), 2)
    entries.push({ list: graphHits, w: 0.8 })

    // E5 概念召回：皮层按概念找 cell，再用 anchorsOf 落回 episode
    let conceptHits = []
    if (adapters?.cortex?.concepts) {
      try {
        const c = adapters.cortex.concepts(query, 10)
        const seen = new Set()
        for (const item of c?.items || []) {
          const anchors = adapters.cortex.anchorsOf?.(item.id)
          for (const epId of anchors?.episodes || []) {
            if (seen.has(epId)) continue
            seen.add(epId)
            conceptHits.push({ id: epId, score: Number(item.score || 0.5) * 0.8, why: 'concept' })
          }
        }
      } catch { /* 皮层没准备好就少一路 */ }
    }
    entries.push({ list: conceptHits, w: 0.8 })

    return weightedRrf(entries)
  }

  /**
   * 同步召回（给心情插件在同一拍里用）。
   * 只走已经在内存里的路：BM25 + 图扩散 + 概念；向量只读已缓存的，缺就跳过。
   * 不 await、不读盘、不写缓存——毫秒级返回。
   * opts: { valence, arousal, beforeMs, excludeMsgId, limit }
   */
  function recallSync(query, opts = {}) {
    const t0 = Date.now()
    const q = String(query || '').trim()
    const want = Math.max(1, Math.min(10, Number(opts.limit) || 3))
    const out = {
      ok: true,
      degraded: false,
      valenceReady: true,
      hits: [],
      at: t0,
      ms: 0,
      source: 'recallSync',
    }
    if (!q) { out.ms = Date.now() - t0; return out }

    // 写路径标脏后必须重建索引，否则"写完立刻查"永远查不到新条目——
    // 这是最常见的用法（刚说完话就问"你还记得我刚才说的吗"）。
    // 走 store 内存重建，不读盘：recallSync 是同步的，磁盘 IO 会卡住调用方。
    if (rowsStale) {
      try {
        const rebuilt = []
        for (const ep of store.allEpisodes()) {
          rebuilt.push({
            episodeId: ep.id,
            session: ep.session || '',
            at: ep.start,
            type: ep.type || '',
            summary: ep.summary || '',
            entities: ep.entities || [],
            keywords: ep.keywords || [],
            place: ep.place || '',
            slot: ep.slots || {},
            confidence: ep.confidence ?? 1,
            accessibility: ep.accessibility ?? 0,
            conceptIds: ep.conceptIds || [],
            semanticRef: ep.semanticRef || null,
            test: Boolean(ep.test),
            v: 1,
          })
        }
        rowsCache = rebuilt
        rowsStale = false
        bm25 = null // BM25 索引对象绑在 rows 上，rows 换了必须重建
      } catch { /* 重建失败就沿用旧的，至少不出空结果 */ }
    }
    // 索引还没进内存（刚启动）→ 明确降级，别让上层以为“想不起来”
    if (!rowsCache || !rowsCache.length) {
      out.ok = false; out.degraded = true; out.reason = 'index-not-loaded'
      out.ms = Date.now() - t0
      return out
    }

    // 注意 Number(null) === 0：上游传 null 表示"不限制"，这里不能算成 0，
    // 否则 beforeMs=0 会把所有 start>=0 的条目全滤掉（hits 空 → 上层静默退回异步）。
    const rawBefore = opts.beforeMs
    const beforeMs = (rawBefore === null || rawBefore === undefined || rawBefore === '')
      ? Infinity
      : (Number.isFinite(Number(rawBefore)) ? Number(rawBefore) : Infinity)
    const excludeMsgId = opts.excludeMsgId ? String(opts.excludeMsgId) : ''

    // 词面校验：query 至少有一个 2 字片段真的出现在这条记忆里。
    // 光靠 BM25 分数不行——"重启完了"只靠虚词也能拿 5.5 分，
    // 捞回来的全是"QQ 不回话多半是绑定的会话"这种不相关的事。
    const qBigrams = new Set()
    const qClean = q.replace(/[\s\p{P}]/gu, '')
    for (let i = 0; i + 1 < qClean.length; i++) qBigrams.add(qClean.slice(i, i + 2))
    const surfaceOk = (ep) => {
      if (!qBigrams.size) return false
      const hay = `${ep.summary || ''} ${(ep.keywords || []).join(' ')} ${(ep.entities || []).join(' ')}`
      const WEAK = /^(?:[了的着过是在有没就都又也还很太会能要个些吗呢吧啊嗯哦呀嘛你我他她它们这那上下里外中几件次点样种步]{2}|今天|明天|昨天|现在|刚才|时候|这个|那个|什么|怎么|为什么|一点|有点|还是|已经|可以|不是|没有|这样|那样|真的|觉得|知道|一个)$/
      let strong = 0
      for (const g of qBigrams) {
        if (!hay.includes(g)) continue
        // "是怎么""了的" 这种两个虚词凑成的片段不算有效重合，
        // 否则问"recallSync 怎么排的"会被含"是怎么"的无关条目抢走。
        if (WEAK.test(g)) continue
        strong++
      }
      return strong > 0
    }

    const keep = (epId) => {
      const ep = store.get(epId)
      if (!ep || ep.test) return false
      // 情绪写回是给心情通路看的（【情绪】…），不抢占"最近发生了什么"的位置。
      // 它摘要只有几个字、信息量为零，放进去只会把真正的对话挤下去。
      // 同时按 type 和文本两路挡：老数据的 type 还是"情绪"，只认 type 会漏。
      if (!opts.includeEmotion && (ep.type === 'emotion' || String(ep.summary || '').startsWith('【情绪】'))) return false
      // 写读先后：这条消息本身还没落库时不能被召回，否则情绪会挂到错的事上
      if (beforeMs !== Infinity && Number(ep.start) >= beforeMs) return false
      if (excludeMsgId && ep.anchor?.msgId === excludeMsgId) return false
      // 以前中继过一次对象文本，库里留了 "[object Object]" 的脏行，不许它出现在回声里
      if (String(ep.summary || '').includes('[object Object]')) return false
      if (!surfaceOk(ep)) return false
      return true
    }

    // 索引对象缓存在 bm25 里，row 一样就复用，不重建
    const idx = bm25 && bm25.rows === rowsCache ? bm25 : makeBm25(rowsCache)

    // 问"在哪儿做的"：place 字段存了就得用上。
    // 必须在候选构建之前判定——否则 BM25 的 top-N 里根本没有那些长记录
    // （短句分数虚高会把它们挤掉），后面排序再对也轮不到它们。
    const ASK_WHERE = /(在哪儿|在哪|哪里|什么地方|哪个地方|去哪)/
    const wantPlace = ASK_WHERE.test(q)
    // 问"用了什么方法 / 怎么做的"：方法存在 slots.tool 里，字面重合接不上
    // （原文"用的是 BM25"，问句"什么方法"），得靠槽位而不是字面。
    const ASK_HOW = /(用什么|什么方法|怎么做的|怎么弄的|怎么做|如何做|用了什么|什么工具|怎么实现的)/
    const wantHow = ASK_HOW.test(q)

    const entries = []
    const bmHits = idx.search(q, 20).filter((h) => keep(h.id))
    entries.push({ list: bmHits, w: 1 })

    const terms = splitTerms(q)
    for (const t of terms) entries.push({ list: idx.search(t, 8).filter((h) => keep(h.id)), w: 1 })

    // 问地点时，把所有带 place 的条目补进候选池
    if (wantPlace) {
      const placeHits = []
      for (const row of rowsCache) {
        if (!keep(row.episodeId)) continue
        const ep = store.get(row.episodeId)
        if (ep?.place || ep?.slots?.where) placeHits.push({ id: row.episodeId, score: 1, why: 'place' })
      }
      entries.push({ list: placeHits, w: 1.2 })
    }

    // 问方法时，把所有带 tool 槽的条目补进候选池
    if (wantHow) {
      const toolHits = []
      for (const row of rowsCache) {
        if (!keep(row.episodeId)) continue
        const ep = store.get(row.episodeId)
        if (ep?.slots?.tool) toolHits.push({ id: row.episodeId, score: 1, why: 'tool' })
      }
      entries.push({ list: toolHits, w: 1.2 })
    }

    const graphHits = spread(bmHits.slice(0, 3).map((h) => h.id), 1).filter((h) => keep(h.id))
    entries.push({ list: graphHits, w: 0.8 })

    // 因果链：命中条目牵出它巩固时记下的前后事件（权重低于图扩散，只做补充）
    const causalHits = causalSpread(bmHits.slice(0, 3).map((h) => h.id)).filter((h) => keep(h.id))
    if (causalHits.length) entries.push({ list: causalHits, w: 0.55 })

    // 概念路：皮层是同步接口，拿不到就少一路
    try {
      const c = adapters?.cortex?.concepts?.(query, 8)
      const seen = new Set()
      const conceptHits = []
      for (const item of c?.items || []) {
        const anchors = adapters?.cortex?.anchorsOf?.(item.id)
        for (const epId of anchors?.episodes || []) {
          if (seen.has(epId) || !keep(epId)) continue
          seen.add(epId)
          conceptHits.push({ id: epId, score: Number(item.score || 0.5) * 0.8, why: 'concept' })
        }
      }
      entries.push({ list: conceptHits, w: 0.8 })
    } catch { /* 皮层没就绪，少一路 */ }

    out.degraded = true // 向量路没走：没有 query 向量就是降级

    let fused = weightedRrf(entries.filter((e) => e.list && e.list.length))
    if (!fused.length) { out.ms = Date.now() - t0; return out }

    // 心境一致性：低落时先想起糟心事，开心时先想起好事。
    // 只有双方都带 valence 才加权；没有 valence 的条目按 0 处理，不加不减。
    const moodV = Number(opts.valence)
    const moodA = Number(opts.arousal)
    if (Number.isFinite(moodV) && Math.abs(moodV) > 0.01) {
      const w = out.degraded ? 0.075 : 0.15 // 降级时只加一半，宁可不出彩
      fused = fused.map((h) => {
        const ep = store.get(h.id)
        const ev = Number(ep?.valence)
        if (!Number.isFinite(ev)) return h
        return { ...h, score: h.score + w * Math.max(0, moodV * ev), why: `${h.why || ''}+mood` }
      })
    }
    // 唤醒度只做微调：高唤醒时分数上限放宽一点点，不影响排序方向
    if (Number.isFinite(moodA) && moodA > 0.5) {
      const k = 1 + 0.05 * Math.min(1, moodA)
      fused = fused.map((h) => ({ ...h, score: h.score * k }))
    }

    fused.sort((a, b) => b.score - a.score)

    // 问"在哪儿做的"：place 字段存了就得用上，不能只靠字面重合。
    // 否则"上次改插件是在哪儿弄的"会答成"职责限定"，明明 records 里有 place=客厅。
    // 必须并进排序键，不能只加 score——后面 cover 排序会把 score 加权整个冲掉。
    // 主排序："命中了几个实词"，BM25 分数只做次键。
    // 原因：BM25 天然偏袒短文档，"心情插件目前的原理是什么"这种短句分数会更虚高，
    // 压过真正长而完整的记录；而"命中几个不同的实词"不看文档长度，稳得多。
    const FILLER_ONLY = /^[了的着过是在有没就都又也还很太会能要个些吗呢吧啊嗯哦呀嘛你我他她它们这那上下里外中几件次点样种步]{1,2}$/
    const qTokens = [...qBigrams].filter((g) => !FILLER_ONLY.test(g))
    const scoreRow = (h) => {
      const ep = store.get(h.id)
      const hay = `${ep?.summary || ''} ${(ep?.keywords || []).join(' ')} ${(ep?.entities || []).join(' ')}`.toLowerCase()
      let cover = 0
      for (const g of qTokens) if (hay.includes(g)) cover++
      const place = ep?.place || ep?.slots?.where || ''
      // 问地点时，有 place 的优先；问方法时，有 tool 的优先。这不是加分，是换主次序
      const placeHit = wantPlace && place ? 1 : 0
      const toolHit = wantHow && ep?.slots?.tool ? 1 : 0
      return { cover, placeHit, toolHit, place }
    }
    fused = fused.map((h) => ({ ...h, ...scoreRow(h) }))
    fused.sort((a, b) => (b.placeHit - a.placeHit) || (b.toolHit - a.toolHit) || (b.cover - a.cover) || (b.score - a.score))

    // 相关度下限：分数不到最高分 18% 的直接丢。
    // 不设这道闸的话，短句（"重启完了"）会靠单个虚词匹配捞回一堆不相干的事，
    // 上层看到的就是"说了句没内容的话，她反而想起三条旧账"。
    const topScore = fused[0]?.score ?? 0
    if (topScore > 0) {
      const floor = topScore * 0.18
      fused = fused.filter((h) => h.score >= floor)
    }
    // 有效词太少（整句只有一个实词甚至没有）→ 宁可不回声，也别硬凑
    const qTerms = splitTerms(q)
    if (qTerms.length === 0 && bmHits.length === 0) {
      out.ms = Date.now() - t0
      return out
    }

    const top = fused.slice(0, want)
    let valenceReady = false
    out.hits = top.map((h) => {
      const ep = store.get(h.id) || {}
      const v = Number(ep.valence)
      const hasV = Number.isFinite(v)
      if (hasV) valenceReady = true
      return {
        id: h.id,
        brief: String(ep.summary || '').slice(0, 60),
        valence: hasV ? v : 0,
        salience: Number(ep.salience) || 0,
        at: Number(ep.start) || 0,
        score: Number(h.score.toFixed(4)),
        why: h.why || '',
      }
    })
    out.valenceReady = valenceReady
    out.ms = Date.now() - t0
    return out
  }

  function finalCueSorted(shapedList, queryText) {
    try {
      const terms = splitTerms(String(queryText || ''), 6).filter((t) => t.length >= 2).map((t) => String(t).toLowerCase())
      __cueLog('enter len=' + (shapedList?.length || 0) + ' q=' + String(queryText || '') + ' terms=' + JSON.stringify(terms))
      if (!terms.length) return shapedList
      const __cueLog = (m) => { try { fs.appendFileSync('E:/brain/_cue.log', m + '\n') } catch {} }
      __cueLog('call len=' + (shapedList?.length || 0) + ' terms=' + JSON.stringify(terms))
      const cueOf = (item) => {
        const ep = store.get(item?.episodeId)
        const hay = `${ep?.summary || ''} ${(ep?.keywords || []).join(' ')} ${(ep?.entities || []).join(' ')}`.toLowerCase()
        let n = 0
        for (const t of terms) if (hay.includes(t)) n += 1
        return n
      }
      __cueLog('cues=' + JSON.stringify(shapedList.map((it) => [String(it?.summary || '').slice(0, 8), cueOf(it)])))
      return [...shapedList].sort((a, b) => (cueOf(b) - cueOf(a)) || (Number(b.score) - Number(a.score)))
    } catch { return shapedList }
  }

  function qTextOf(v, o) {
    if (typeof v === 'string') return v
    if (v && typeof v === 'object') return String(v.query || v.text || v.q || '')
    return String(o?.query || o?.text || '')
  }

  async function fallbackRaw(query, opts) {
    const raw = await readRawDays(7)
    const q = String(query || '').toLowerCase()
    const tokens = q.split(/[\s,，。！？；:：]+/).filter((t) => t.length >= 2)
    const hits = []
    for (const row of raw) {
      if (!opts.includeTest && isTestText(row.text)) continue // 测试数据不许从兜底路混进来
      const hay = String(row.text || '').toLowerCase()
      let hit = 0
      for (const t of tokens) if (hay.includes(t)) hit += 1
      if (hit) hits.push({ row, hit })
    }
    hits.sort((a, b) => b.hit - a.hit)
    return hits.slice(0, opts.k || 5).map((h) => ({
      episodeId: null,
      session: h.row.session,
      at: h.row.at,
      summary: String(h.row.text || '').slice(0, 60),
      rawIds: [h.row.id],
      lowConfidence: true,
      why: 'raw-fallback',
    }))
  }

  /** 序列查询：这个 episode 之前/之后发生了什么（L3-12）。 */
  async function sequence(episodeId, direction = 'after', limit = 5) {
    const ep = store.get(episodeId)
    if (!ep) return []
    // 全局按时间排：只在同 session 里找，跨会话的记忆就没有"先后"了
    return store
      .allEpisodes()
      .filter((x) => x.id !== ep.id && !x.test)
      .filter((x) => (direction === 'after' ? x.start > ep.start : x.start < ep.start))
      .sort((a, b) => (direction === 'after' ? a.start - b.start : b.start - a.start))
      .slice(0, limit)
      .map((x) => ({
        episodeId: x.id,
        at: x.start,
        summary: x.summary,
        type: x.type,
        session: x.anchor?.sessionId || '',
      }))
  }

  async function recall(query, opts = {}) {
    const q = String(query || '').trim()
    if (!q) return { hits: [], mode: 'none', coverage: 0, lowConfidence: true }

    // E3：前额叶在就用它判意图，不在走正则
    let plan = null
    if (adapters?.prefrontal?.plan) plan = await safe(() => adapters.prefrontal.plan(q, { session: opts.session }), null, 80)

    let mode = opts.mode && opts.mode !== 'auto' ? opts.mode : 'auto'

    // 前额叶说“这句不用查”（chat/empty 意图）就直接回空，别硬凑
    if (mode === 'auto' && plan?.mode === 'skip') {
      return {
        hits: [], mode: 'skip', plan, material: null,
        boundaryCross: false, coverage: 0, vectorReady: false, lowConfidence: true,
      }
    }

    if (mode === 'auto') {
      if (plan?.mode === 'separate' || plan?.mode === 'complete') mode = plan.mode
      else if (plan?.mode === 'sequence') mode = 'complete' // 序列路由走 sequence()
      else mode = /\d{4,}|[「『"“]|uid|账号|号码/.test(q) || optionsWantsExact(opts) ? 'separate' : 'complete'
    }
    if (plan?.filters?.type && !opts.type) opts = { ...opts, type: plan.filters.type }
    if (plan?.filters?.since && !opts.since) opts = { ...opts, since: plan.filters.since }

    let hits = mode === 'separate' ? await separate(q, opts) : await complete(q, opts)
    // 作废的 episode 一律不进结果。索引快照过滤挡不住图扩散/概念召回——
    // 它们直接 store.get 拼条目，实测作废条目从 graph 路又冒回来了。
    hits = hits.filter((h) => store.get(h.id || h.episodeId)?.state !== 'retracted')
    if (opts.type) hits = hits.filter((h) => store.get(h.id)?.type === opts.type)
    if (opts.session) hits = hits.filter((h) => store.get(h.id)?.anchor?.sessionId === opts.session)
    if (opts.since) hits = hits.filter((h) => Number(store.get(h.id)?.start || 0) >= opts.since)
    // 测试数据默认不来抢座次；要查就显式 includeTest
    if (!opts.includeTest) hits = hits.filter((h) => !store.get(h.id)?.test)

    // 阈值抑制（L3-4）：低于阈值不进结果，不是截断 top-k
    const minScore = mode === 'separate' ? 1 : (opts.minScore ?? 0.004)
    hits = hits.filter((h) => h.score >= minScore)
    // L2-13 多线索归并 → R3 抑制 → 截断
    hits = inhibit(mergeByEpisode(hits)).slice(0, opts.k || 5)

    // L3-7 复述 vs 本体
    const shaped = markRestatements(hits.map((h) => shape(h)).filter(Boolean))

    // L5-2 时间梯度：新条目可及性略占优，但不压过相关性（0.7–1 的乘子）
    for (const item of shaped) {
      const ep = store.get(item.episodeId)
      if (!ep) continue
      const g = timeGradient(ep)
      item.score = Number((item.score * g.accessibilityBias).toFixed(4))
    }
    // 实词优先：问"海边"先想起海边那条。这里是最后一道排序，前面的 cover 会被这次重排冲掉。
    const cueTerms = splitTerms(qTextOf(query, opts), 6).filter((t) => t.length >= 2).map((t) => t.toLowerCase())
    const cueCount = (item) => {
      const ep = store.get(item.episodeId)
      const hay = `${ep?.summary || ''} ${(ep?.keywords || []).join(' ')} ${(ep?.entities || []).join(' ')}`.toLowerCase()
      let n = 0
      for (const t of cueTerms) if (hay.includes(t)) n += 1
      return n
    }
    for (const item of shaped) item.cue = cueCount(item)
    try { (globalThis.__dbgCue ||= []).push({ q: qTextOf(query, opts), cueTerms, order: shaped.map((x) => [String(store.get(x.episodeId)?.summary || '').slice(0, 10), x.cue, Number(x.score).toFixed(3)]) }) } catch {}
    shaped.sort((a, b) => (b.cue - a.cue) || (b.score - a.score))

    // 补全模式：一条线索要能带出一串。只回一条说明这在查库，不在回忆。
    if (mode === 'complete' && shaped.length && shaped.length < Math.max(3, opts.k || 5)) {
      const want = Math.max(0, Math.max(3, opts.k || 5) - shaped.length)
      const more = spread([shaped[0].episodeId], 2)
        .filter((x) => !shaped.some((s) => s.episodeId === x.id))
        .slice(0, want)
        .map((x) => shape(x))
        .filter(Boolean)
      shaped.push(...more)
    }

    // 查询里有否定词（¬喜欢）时，只留同样带否定表述的候选——
    // 「她不太喜欢什么」不该先答「她喜欢我多说一点」。
    // 一条否定候选都没有才保留原结果（库里真没记过“不喜欢”的时候不能空手）。
    const negTerms = [...tokenize(q).keys()].filter((t) => t.startsWith('¬'))
    if (negTerms.length && shaped.length) {
      // 候选里只要有任意否定标记（¬喜欢 / ¬接受 / ¬负面）就算同类
      const withNeg = shaped.filter((item) => {
        const ep = store.get(item.episodeId)
        const tt = ep ? tokenize(`${ep.summary || ''} ${(ep.keywords || []).join(' ')}`) : new Map()
        return [...tt.keys()].some((k) => k.startsWith('¬'))
      })
      if (withNeg.length) {
        shaped.length = 0
        shaped.push(...withNeg)
      }
    }

    // 扩散补进来的也可能是测试数据：统一在出口再清一遍
    if (!opts.includeTest) {
      for (let i = shaped.length - 1; i >= 0; i -= 1) {
        if (store.get(shaped[i].episodeId)?.test) shaped.splice(i, 1)
      }
    }

    // 分数归一化：不同查询的第一名不能再是同一个绝对值（那说明排序没起作用）
    const topScore = shaped[0]?.score || 0
    for (const item of shaped) {
      item.normalized = topScore > 0 ? Number((item.score / topScore).toFixed(4)) : 0
    }

    // L2-16 边界：结果跨天就标出来，别把两天的当成一件
    const boundaryCross = shaped.length > 1
      && new Date(shaped[0].at).toDateString() !== new Date(shaped[shaped.length - 1].at).toDateString()

    // 低覆盖：结果太少时补原始层兜底，并标 lowConfidence（L3-8/L3-13）
    let lowConfidence = false
    if (!shaped.length && mode === 'complete') {
      shaped.push(...(await fallbackRaw(q, { k: opts.k || 3, includeTest: opts.includeTest })))
      lowConfidence = shaped.length > 0
    }

    // L3-10 前额叶校验：分层采纳。
    // 规则（与 inhibit 的 RESTORABLE 对齐）：
    //   事实性错误（作废/主体不对/时间不对/违反约束）→ 允许删除；
    //   软性问题（low-score / archived）→ 只降置信、不删，绝不拿"不够好"当"不该在"。
    //   排序权仍归召回：实测让 judge 重排会把"被领导骂"挤到"海边散步"后面，向量路也会丢。
    if (adapters?.prefrontal?.verify && shaped.length) {
      try {
        const v = await Promise.resolve(adapters.prefrontal.verify(shaped, { plan, query: q, mode }))
        const SOFT = new Set(['low-score', 'archived', 'duplicate', 'restatement'])
        const dropIds = new Set()
        for (const x of (v?.suppressed || [])) {
          if (!x) continue
          const id = String(x.id || x.episodeId || '')
          if (!id) continue
          if (!SOFT.has(String(x.reason || ''))) dropIds.add(id)
        }
        const byId = new Map()
        for (const x of (Array.isArray(v) ? v : (v?.verdicts || []))) {
          if (!x) continue
          const id = String(x.episodeId || x.id || '')
          if (!id) continue
          byId.set(id, x)
          // 显式判死且不是软理由，才算事实性错误
          if ((x.keep === false || x.verdict === 'drop') && !SOFT.has(String(x.reason || ''))) dropIds.add(id)
        }
        if (dropIds.size) {
          for (let k = shaped.length - 1; k >= 0; k -= 1) {
            if (dropIds.has(String(shaped[k].episodeId))) shaped.splice(k, 1)
          }
        }
        // 全被砍了不许空手：留原第一名并标 hedge（R3）
        if (!shaped.length) {
          const back = markRestatements(hits.map((h) => shape(h)).filter(Boolean)).slice(0, 1)
          if (back.length) { back[0].flags = [...new Set([...(back[0].flags || []), 'hedge', 'restored'])]; shaped.push(...back) }
        }
        for (const item of shaped) {
          const vv = byId.get(String(item.episodeId))
          if (!vv) continue
          const conf = Number(vv.confidence)
          if (Number.isFinite(conf)) item.confidence = conf
          if (Array.isArray(vv.flags) && vv.flags.length) item.flags = [...new Set([...(item.flags || []), ...vv.flags])]
        }
      } catch { /* 校验挂了不影响返回 */ }
    }

    // L3-5 未来素材包（只抽槽位）
    const material = buildMaterial(shaped)

    const cov = await vectorCoverage()

    // 痕迹（L2-5）：记下查询、模式、命中，还有当时的上下文（L3-6 失真判断用）
    try {
      await appendJsonl(FILES.traces, {
        at: Date.now(),
        query: q.slice(0, 120),
        mode,
        hits: finalCueSorted(shaped, qTextOf(typeof q !== 'undefined' ? q : query, opts)).map((x) => x.episodeId).filter(Boolean),
        lowConfidence,
        context: String(opts.context || '').slice(0, 80) || recentContext(),
      })
    } catch { /* 痕迹写不进去不影响回答 */ }

    // 标签-捕获：召回过的条目把显著性绑到 id 上
    try {
      const amy = adapters?.amygdala
      try { appendFileSync('C:/dsh-data/hippocampus/_bind-debug.log', JSON.stringify({ at: Date.now(), reached: true, hasAmy: Boolean(amy), hasBind: typeof amy?.bind, shaped: shaped.length }) + '\n') } catch {}
          if (amy && typeof amy.bind === 'function') {
        for (const h of shaped.slice(0, 8)) {
          const ep = store.get(h.episodeId)
          if (!ep) continue
          amy.bind({ id: h.episodeId, score: Number(ep.salience) || 0, confidence: Number(ep.confidence) || 0, tags: ep.tags || [], source: { channel: 'recall' } })
        }
      }
    } catch (e) {
          try {
            appendFileSync('C:/dsh-data/hippocampus/_bind-debug.log', JSON.stringify({ at: Date.now(), err: String(e?.message||e), hasAmy: Boolean(adapters?.amygdala), hasBind: typeof adapters?.amygdala?.bind, shaped: shaped.length }) + '\n')
          } catch {}
        }

    return {

      hits: finalCueSorted(shaped, qTextOf(typeof q !== 'undefined' ? q : query, opts)),
      mode,
      plan,
      material,
      boundaryCross,
      coverage: cov.ratio,
      vectorReady: cov.have > 0,
      lowConfidence,
    }
  }

  /** 预热：把最近 N 条索引行的向量补上（后台跑，不阻塞）。 */
  async function warmVectors(limit = 200) {
    const r = (await rows()).slice(-limit)
    let done = 0
    for (const row of r) {
      if (vecCache.has(row.episodeId)) continue
      const v = await embed(row.summary || '')
      vecCache.set(row.episodeId, v)
      if (v) done += 1
    }
    return { done, total: r.length }
  }

  /**
   * 覆盖率：只数"索引行有没有向量"，不数缓存里放过多少条文本。
   * 以前直接拿 vectors.json 的条数当 have——查询串的向量也算进去了，
   * 于是会出现 have 5 / total 3 这种不可能的比例（比 100% 还高）。
   * recall 真正能用的是 vecCache 里按 episodeId 存的那些，所以以它为准。
   */
  async function vectorCoverage() {
    const r = await rows()
    const total = r.length
    let have = 0
    for (const row of r) {
      const v = vecCache.get(row.episodeId)
      if (Array.isArray(v) && v.length) have += 1
    }
    const base = await coverage(total)
    return {
      model: base.model,
      dim: base.dim,
      have,
      total,
      ratio: total > 0 ? have / total : 0,
    }
  }

  async function stats() {
    const cov = await vectorCoverage()
    return { indexRows: cov.total, ...cov, vecCached: vecCache.size }
  }

  /** L3-6：提取时的上下文快照（单器官阶段用最近一条事件的主题代替心情）。 */
  function recentContext() {
    const last = store.allEpisodes().slice(-1)[0]
    if (!last) return null
    return `${last.type || '未知'}·${(last.keywords || []).slice(0, 3).join('/')}`
  }

  /** 预热索引到内存：启动时调一次，recallSync 才不会一上来就降级。 */
  async function primeIndex() {
    try {
      const r = await rows()
      return { ok: true, rows: r.length }
    } catch (e) {
      return { ok: false, error: String(e?.message || e) }
    }
  }

  return { recall, recallSync, primeIndex, sequence, warmVectors, warmVectorFor, invalidate, stats, rows }
}

function optionsWantsExact(opts) {
  return opts.exact === true
}

/** 跨器官调用一律带超时（R16），超时吃默认。 */
async function safe(fn, fallback, timeoutMs = 80) {
  try {
    const p = Promise.resolve().then(fn)
    const t = new Promise((resolve) => setTimeout(() => resolve(fallback), timeoutMs))
    return await Promise.race([p, t])
  } catch {
    return fallback
  }
}
