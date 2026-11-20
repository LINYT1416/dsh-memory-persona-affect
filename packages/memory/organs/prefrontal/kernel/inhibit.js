// #P3 抑制：错配过滤 / 否定压制 / 粒度 / 下限 / 负载耦合 / 可撤销 / 冲突监测
// 规矩（R3）：只在 episode 粒度砍，砍之前记账，砍完不许空手（P3-4）。
import { negation, polarity, clamp, overlap } from './text.js'

const REASON = { time: '时间不对', type: '类型不对', entity: '主体不对', negated: '已被否定', archived: '已归档' }

/** 单条为什么不该进结果。返回 null 表示可以留。 */
export function mismatch(cand, plan = {}, ctx = {}) {
  const f = plan.filters || {}
  if (cand.state === 'archived' && ctx.allowArchived !== true) return 'archived'
  // 被作废的条目不许当正面证据：皮层的 retracted、海马体的 retired 都算。
  // 只砍证据，不删记录（R20），suppressed 里留痕可审计。
  if (cand.state === 'retracted') return 'negated'
  if (cand.retracted === true) return 'negated'
  if (f.since && Number(cand.at) < f.since) return 'time'
  if (f.until && Number(cand.at) >= f.until) return 'time'
  if (f.type && cand.type && cand.type !== f.type) return 'type'
  // 主体不对：明确指定了主体、且候选能说出自己的主体、且对不上 → 砍。
  // 候选没写主体就不砍——宁可漏，不可错。
  if (f.subject && Array.isArray(cand.entities) && cand.entities.length) {
    const want = String(f.subject)
    const has = cand.entities.some((e) => String(e).includes(want) || want.includes(String(e)))
    if (!has) return 'entity'
  }
  return null
}

/**
 * 否定压制：query 在问"A 对不对"，而候选本身是"A 不是"——不能当正面证据。
 * 作用域判断交皮层（F11），这里只做字面级：候选否定的是不是 query 在问的那个东西。
 */
export function negate(cand, query) {
  const cn = negation(cand.summary)
  if (!cn) return null
  const q = String(query || '')
  if (cn.strong) return 'negated'
  // 候选否定词后面那段，就是"它否认的东西"；query 在问它 → 这条不能当正面证据
  if (cn.scope && q.includes(cn.scope)) return 'negated'
  // 逐 2-gram 兜一层（scope 可能被标点切短）
  const scope = String(cn.scope || '')
  for (let i = 0; i < scope.length - 1; i += 1) {
    const g = scope.slice(i, i + 2)
    if (g.length === 2 && q.includes(g)) return 'negated'
  }
  return null
}

/**
 * 夹具/测试数据识别（隔离，不是判内容）。
 * 库里那些"测试：xxx（可删）"是调试写的，它会跟真记忆抢座次。
 * 只按**显式标记**隔离，不做语义判断；隔离后仍留在 suppressed 里可审计。
 */
export const FIXTURE_MARKERS = ['测试：', '测试:', '可删', 'testdata', 'test data', 'lorem ipsum']

export function isFixture(cand, markers = FIXTURE_MARKERS) {
  const text = String(cand?.summary ?? '')
  if (!text) return false
  const low = text.toLowerCase()
  return markers.some((m) => low.includes(m.toLowerCase()))
}

/**
 * 硬约束（R5）：规则全程不放开，读出口也管。
 * 这是"不许提 X"能真的不出现的地方——只写在写入口（gate）是不够的。
 */
export function ruleBlock(cands = [], rules = []) {
  const kept = []
  const blocked = []
  for (const c of cands) {
    const hit = (rules || []).find((r) => r?.text && String(c.summary || '').includes(r.text))
    if (hit) blocked.push({ id: c.episodeId || c.id, reason: 'rule', why: `违反约束：${hit.text}` })
    else kept.push(c)
  }
  return { kept, blocked }
}

/**
 * 同会话近邻去重（#P3-3 粒度）：
 * 只有"同一会话 + 60 秒内 + 摘要高度重叠"才合并。
 * 上一版只按 20 分钟窗口合并，把同一次对话里连续几条不同的事全并成一条——
 * 真实记忆全被吃掉，只剩分最高的那条（住院那条就是这么丢的）。
 */
export function grain(list = []) {
  const picked = []
  for (const hit of list) {
    const dup = picked.find((p) => p.session
      && p.session === hit.session
      && Math.abs((p.at || 0) - (hit.at || 0)) < 60 * 1000
      && overlap(String(p.summary || ''), String(hit.summary || '')) >= 0.6)
    if (!dup) picked.push(hit)
  }
  return picked
}

/**
 * 负载耦合（#P3-5）：负载高 → 抑制变弱（阈值放松）。
 * 注意：只动阈值，不动下限（R6）。这两个参数作用不同，不许混。
 */
export function loadBias(ctx = {}) {
  const tasks = Number(ctx.openTasks || 1)
  const turns = Number(ctx.turn || 0)
  const load = clamp((tasks - 1) * 0.15 + turns / 400, 0, 0.6)
  return { load, threshold: 1 - load * 0.5 }
}

/**
 * 抑制主流程。返回 {kept, suppressed, restored}。
 * restored 表示"砍空了以后捞回来一条"——这条必须标记，否则看起来像正常结果。
 */
export function apply(cands = [], plan = {}, ctx = {}) {
  const { threshold } = loadBias(ctx)
  const kept = []
  const suppressed = []
  for (const cand of cands) {
    if (isFixture(cand)) {
      suppressed.push({ id: cand.episodeId || cand.id, reason: 'fixture', why: '测试数据，先隔离' })
      continue
    }
    const m = mismatch(cand, plan, ctx)
    const n = m ? null : negate(cand, plan.query)
    if (m || n) suppressed.push({ id: cand.episodeId || cand.id, reason: m || n, why: REASON[m || n] || '被压制' })
    else kept.push(cand)
  }
  // 阈值型稀疏：低于阈值的移出，但不是 top-k 截断
  const max = Math.max(0, ...kept.map((k) => Number(k.score) || 0))
  const floorScore = max * 0.25 * threshold
  const pass = []
  for (const cand of kept) {
    if ((Number(cand.score) || 0) < floorScore && kept.length > 1) {
      suppressed.push({ id: cand.episodeId || cand.id, reason: 'low-score', why: '分数太低' })
    } else pass.push(cand)
  }
  const demo = demote(grain(pass))
  return { kept: demo.kept, suppressed, demoted: demo.demoted, threshold: Number(threshold.toFixed(3)) }
}

/**
 * 退场索引降权（文档 §3.4 / 遗忘是功能：降权、归档、可恢复）。
 *
 * 海马体的 transferState 有三个值：
 *   held     还在索引里
 *   shadowed 索引已被影子顶替
 *   retired  索引已退场（内容仍在皮层，随时可查）
 *
 * retired/shadowed 的原文还有用，但**不该跟活跃记忆平起平坐抢座次**——
 * 实测一次检索的 top4 全是 retired，活跃的反而排在后面。
 * 所以这里只降权到 55%，不删、不拦，suppressed 里也不记（它不是被压制）。
 */
export const RETIRED_FACTOR = 0.55

export function demote(list = []) {
  let n = 0
  const out = list.map((c) => {
    const ts = c?.transferState
    if (ts !== 'retired' && ts !== 'shadowed') return c
    n += 1
    return {
      ...c,
      score: (Number(c.score) || 0) * RETIRED_FACTOR,
      rankScore: (Number(c.rankScore) || 0) * RETIRED_FACTOR,
      retiredIndex: true,
    }
  })
  return { kept: out, demoted: n }
}

/** 下限（#P3-4）：砍空了必须捞回一条，宁可标"低置信"也不许半截空手。 */
export function floor(kept, suppressed, all = []) {
  if (kept.length > 0) return { kept, restored: null }
  const byScore = [...all].sort((a, b) => (Number(b.score) || 0) - (Number(a.score) || 0))
  const back = byScore[0]
  if (!back) return { kept, restored: null }
  return { kept: [back], restored: back.episodeId || back.id }
}

/**
 * 冲突监测（#P3-7 / ACC）：候选之间互相对立时报警。
 * 只报"同实体 + 相反极性"，语义对立交皮层（F11）。
 */
export function alert(cands = []) {
  const pairs = []
  for (let i = 0; i < cands.length; i += 1) {
    for (let j = i + 1; j < cands.length; j += 1) {
      const a = cands[i]
      const b = cands[j]
      const pa = polarity(a.summary)
      const pb = polarity(b.summary)
      if (pa === 0 || pb === 0 || pa === pb) continue
      const shared = sharedEntity(a, b)
      if (shared) pairs.push({ a: a.episodeId || a.id, b: b.episodeId || b.id, entity: shared })
    }
  }
  return pairs
}

function sharedEntity(a, b) {
  const A = new Set((a.entities || []).map((x) => String(x)))
  for (const e of b.entities || []) if (A.has(String(e))) return String(e)
  return null
}
