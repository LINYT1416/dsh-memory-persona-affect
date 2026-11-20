// #F4 pf.judge —— 唯一的出口。
// 顺序固定（R2/R3/R12）：来源 → 抑制 → 下限 → 冲突 → 置信 → 排序 → 断言语义 → 预演采信。
// T0 只做算术，不发任何 async（C3）。
import { ensure as ensureSource, uniformize } from './source.js'
import * as inhibit from './inhibit.js'
import * as conflict from './conflict.js'
import * as flags from './flags.js'
import * as score from './score.js'
import * as value from './value.js'
import * as meta from './meta.js'
import * as routes from './routes.js'
import { targetFit } from './target.js'
import { clamp, round, overlap } from './text.js'

const TEMPLATES = [
  '没有找到相关记忆',
  '不确定',
  '这条不太确定',
  '被我压掉了，不是没有',
  '库里有这类东西，这次没找到',
  '确实没有',
  '有结果但置信不高',
  '低置信，措辞要留余地',
  '时间不对',
  '类型不对',
  '主体不对',
  '已被否定',
  '已归档',
  '分数太低',
  '低置信',
]

/**
 * @param {Array} cands 海马返回的候选
 * @param {Object} ctx {query, plan, now, coverage, calibration, seams, capabilities, goal, turn, openTasks, justSwitched}
 */
export function judge(cands = [], ctx = {}) {
  const now = ctx.now || Date.now()
  const plan = ctx.plan || { query: ctx.query || '', filters: {} }
  const items = uniformize((cands || []).map((c) => {
    const id = c.episodeId || c.id
    // F8：候选自己没带来源时，问海马（问不到就是 absent，答不了是 unknown，都不猜）
    let fromSeam = null
    let srcTri = null
    if (!c.source?.kind && ctx.seams?.source && id) {
      const r = ctx.seams.source(id)
      srcTri = r?.tri || null
      if (r?.tri === 'value' && r.value) fromSeam = r.value
    }
    return {
      ...c,
      episodeId: id,
      at: Number(c.at) || now,
      score: Number(c.score) || 0,
      why: Array.isArray(c.why) ? c.why : String(c.why || '').split('+').filter(Boolean),
      entities: Array.isArray(c.entities) ? c.entities : [],
      source: ensureSource(c, fromSeam, srcTri),
    }
  }))

  // 1) 抑制
  const applied = inhibit.apply(items, plan, {
    now,
    turn: ctx.turn,
    openTasks: ctx.openTasks,
    allowArchived: ctx.allowArchived,
  })

  // 2) 硬约束（R5：规则全程不放开，读出口也要管）——违反约束的候选直接不出
  const ruled = inhibit.ruleBlock(applied.kept, ctx.rules || [])
  const suppressedAll = [...applied.suppressed, ...ruled.blocked]
  const blockedIds = new Set(ruled.blocked.map((b) => b.id))

  // 3) 下限：砍空必须捞回一条——但只捞"排序性"和"冷档"压掉的
  //    （时间不对/主体不对/已被否定/违反约束 = 事实性错误，捞回来就是把错的给出去，比空手更糟）
  const RESTORABLE = new Set(['low-score', 'archived'])
  const factualIds = new Set(
    suppressedAll.filter((s) => !RESTORABLE.has(s.reason)).map((s) => s.id),
  )
  const restorable = items.filter((i) => !factualIds.has(i.episodeId))
  const floored = inhibit.floor(ruled.kept, suppressedAll, restorable)
  if (floored.restored) {
    const one = floored.kept[0]
    one.flags = flags.merge(one.flags, ['restored'])
    one.why = [...(one.why || []), 'restored:砍空后捞回']
  }

  // 4) 冲突（结构级 + ACC 对立监测）
  const accPairs = inhibit.alert(floored.kept).map((p) => ({ ...p, field: 'acc', kind: 'acc' }))
  const pairs = conflict.dedupe([...conflict.scan(floored.kept), ...accPairs])
  const pairOf = new Map()
  for (const p of pairs) {
    for (const [self, other] of [[p.aId, p.bId], [p.bId, p.aId]]) {
      const list = pairOf.get(self) || []
      list.push(other)
      pairOf.set(self, list)
    }
  }

  // 5) 置信信号
  const gap = score.gapOf(floored.kept)
  const hist = score.histOf(ctx.calibration, plan.intent)
  const weightTable = routes.weights(plan.intent, ctx.capabilities || {})
  const available = Object.keys(weightTable).length || 1
  const unknownRefs = floored.kept.filter((c) => c.source.tri === 'unknown').length
  const absentRefs = Object.values(ctx.capabilities || {}).filter((v) => v === false).length
    + floored.kept.filter((c) => c.source.tri === 'absent').length

  // 5) 逐条出 verdict（rank/hedge 抽成独立函数，方便单测和文档对照）
  const maxScore = Math.max(...floored.kept.map((c) => Number(c.score) || 0), 1e-6)
  const verdicts = floored.kept.map((c) => {
    const hitRoutes = routes.routesHit(c.why)
    const conf = score.compose(
      [
        { name: 'gap', value: gap },
        { name: 'routes', value: routes.weightedScore(hitRoutes, weightTable) },
        { name: 'coverage', value: clamp(Number(ctx.coverage) || 0) },
        { name: 'hist', value: hist.value },
      ],
      { unknown: unknownRefs, absent: absentRefs },
    )

    // R3：第二轮起置信封顶 0.6——不许越搜越自信
    const roundNow = Number(ctx.round) || 1
    const confValue = roundNow >= 2 ? Math.min(conf.conf, 0.6) : conf.conf

    const recency = 1 + clamp(1 - (now - c.at) / (7 * 86400000)) * 0.05
    const vBias = value.bias({
      goal: value.goalFitOf(c, ctx.goal).value,
      reward: value.rewardOf(c).value,
      self: value.selfOf(c).value,
    })
    // P1-4：检索目标要真的参与排序
    const fit = targetFit(c, plan.target)
    const base = Number(c.score) || 0.01
    const final = base * c.source.trust * recency * vBias.mult * (0.95 + fit * 0.1)
    // 重排主项：相关度 50% + 归一化检索分 30% + 价值 20%，再乘来源可信度
    // （推断来源 trust 0.4 该被压下去，不能被"分高"顶上来）
    const rel = relevanceOf(c, plan)
    const norm = base / maxScore
    const rankScore = (0.5 * rel + 0.3 * norm + 0.2 * vBias.value) * c.source.trust

    const flagsList = []
    if (hist.cold) flagsList.push('cold')
    if (!c.source.known) flagsList.push('degraded')
    if (roundNow >= 2) flagsList.push('round2')
    if (confValue < conf.conf) flagsList.push('capped')
    // P3-6：以前被压过、现在又冒出来的，要标出来（不是直接丢，但要让人看见）
    if (ctx.wasSuppressed?.(c.episodeId)) flagsList.push('reappeared')

    const v = {
      id: c.episodeId,
      keep: true,
      rank: 0,
      score: round(final),
      rankScore: round(rankScore),
      relevance: rel,
      usable: round(confValue),
      confidence: round(confValue),
      source: { kind: c.source.kind, trust: round(c.source.trust), channel: c.source.channel },
      conflictWith: pairOf.get(c.episodeId) || [],
      why: [
        `score:${round(base, 3)}`,
        `trust:${round(c.source.trust, 2)}`,
        `value:${vBias.value}`,
        ...hitRoutes.map((r) => `route:${r}`),
        ...(hist.cold ? ['cold:样本不足'] : []),
        ...(conf.capped ? ['capped:有unknown'] : []),
        ...(confValue < conf.conf ? ['capped:第二轮封顶'] : []),
      ],
      signals: conf.signals,
      flags: flags.merge(c.flags || [], flagsList),
      at: c.at,
      summary: c.summary,
    }
    return hedge(v)
  })

  rank(verdicts)

  // 6) 空手：不许断言（#P2-8）
  const outFlags = []
  const constraint = noAssert(verdicts, {
    suppressed: suppressedAll.length,
    coverage: ctx.coverage,
    intent: plan.intent,
    calibration: ctx.calibration,
  })
  if (constraint?.forbidAssert) {
    outFlags.push('no-assert')
    outFlags.push(constraint.feeling)
  }

  // 7) 预演采信
  const adopted = meta.adopt(ctx.topicDirection, { hits: verdicts.length, justSwitched: ctx.justSwitched })

  return {
    verdicts,
    suppressed: suppressedAll,
    conflicts: pairs,
    constraint,
    adopted,
    flags: flags.merge(outFlags, [
      ...(floored.restored ? ['restored'] : []),
      ...(suppressedAll.length ? ['suppressed'] : []),
      ...(ruled.blocked.length ? ['rule-blocked'] : []),
    ]),
    meta: {
      gap: round(gap),
      availableRoutes: available,
      unknownRefs,
      absentRefs,
      threshold: applied.threshold,
      cold: hist.cold,
      ruleBlocked: ruled.blocked.length,
      round: Number(ctx.round) || 1,
    },
  }
}

/**
 * #P1-9 重排：按"相关度 > 检索分 > 价值"排，不按原始分排。
 * 为什么：海马体给的是 RRF 分（1/(60+rank) 量级），两条真实/噪声都能落在 0.048–0.05，
 * 光比 score 比不出谁对。相关度才是排序主项；score 只做 30% 的辅助。
 */
export function rank(verdicts = []) {
  verdicts.sort((a, b) => {
    const d = (b.rankScore ?? 0) - (a.rankScore ?? 0)
    return d !== 0 ? d : (b.score ?? 0) - (a.score ?? 0)
  })
  verdicts.forEach((v, i) => { v.rank = i + 1 })
  return verdicts
}

/**
 * 相关度：字面 + 目标契合，取最大。
 * 只做字面重叠，不做语义（C1）——语义召回是皮层的活。
 */
export function relevanceOf(cand, plan = {}) {
  const q = String(plan?.query || '')
  const t = String(plan?.target?.text || '')
  const text = `${cand.summary || ''} ${(cand.entities || []).join(' ')}`
  const byQ = overlap(q, text)
  const byT = t ? overlap(t, text) : 0
  const byTarget = targetFit(cand, plan?.target)
  return Number(Math.max(byQ, byT, byTarget).toFixed(4))
}

/** #P2-11 低置信行为：不让它装确定。 */
export function hedge(v) {
  if (!v) return v
  if (Number(v.confidence) < 0.45) v.flags = flags.merge(v.flags || [], ['hedge'])
  return v
}

/**
 * #P2-8 空手禁断言。
 * 返回 null = 不需要约束；返回对象 = 生成端必须照做。
 */
export function noAssert(verdicts = [], ctx = {}) {
  if (!verdicts.length) {
    const f = meta.fok({
      hits: 0,
      suppressed: ctx.suppressed || 0,
      coverage: ctx.coverage,
      intent: ctx.intent,
      calibration: ctx.calibration,
    })
    return { forbidAssert: true, hedge: true, note: f.why, feeling: f.feeling }
  }
  if (Number(verdicts[0]?.confidence ?? 0) < 0.45) {
    return { forbidAssert: false, hedge: true, note: '低置信，措辞要留余地', feeling: 'uncertain' }
  }
  return null
}

/**
 * C1 不变式：输出里"像内容"的字段，必须来自输入 ∪ 模板。
 * 两道检查：
 *   1. 内容字段（summary/note/label/…）逐词比对——这是"不产出内容"的正面保证
 *   2. 任何超过 60 字的字符串字段，必须是某条输入的子串——防止把句子塞进 why 里
 * 机器执行，不靠自觉。
 */
export const CONTENT_KEYS = new Set(['summary', 'label', 'note', 'title', 'line', 'text'])

export function invariant(output, inputs = [], templates = TEMPLATES) {
  const src = new Set()
  const raw = []
  for (const s of inputs) {
    const str = String(s ?? '')
    raw.push(str)
    for (const t of str.split(/[\s，。！？、；：""''（）()·]+/)) if (t) src.add(t)
  }
  const tpl = new Set(templates)
  const bad = []
  const walk = (v, path, key) => {
    if (typeof v === 'string') {
      if (CONTENT_KEYS.has(key)) {
        for (const t of v.split(/[\s，。！？、；：""''（）()·]+/)) {
          if (!t) continue
          if (/^\d+(\.\d+)?$/.test(t)) continue // 数字是算出来的，允许
          if (src.has(t) || tpl.has(t) || tpl.has(v)) continue
          bad.push({ path, text: t, why: '内容字段出现输入里没有的词' })
        }
      } else if (v.length > 60) {
        if (raw.some((r) => r.includes(v)) || tpl.has(v)) return
        bad.push({ path, text: v.slice(0, 40), why: '长文本不是来自输入' })
      }
      return
    }
    if (Array.isArray(v)) { v.forEach((x, i) => walk(x, `${path}[${i}]`, key)); return }
    if (v && typeof v === 'object') {
      for (const [k, x] of Object.entries(v)) walk(x, `${path}.${k}`, k)
    }
  }
  walk(output, '$', null)
  return { ok: bad.length === 0, bad, inputs: raw.length }
}

/** 候选之间的互相"复述"标记（同一实体 + 高重叠）→ 后者标成复述，不删。 */
export function markRestatement(verdicts = [], cands = []) {
  const byId = new Map(cands.map((c) => [c.episodeId || c.id, c]))
  for (const v of verdicts) {
    const me = byId.get(v.id)
    if (!me) continue
    for (const other of verdicts) {
      if (other.id === v.id) continue
      const o = byId.get(other.id)
      if (!o) continue
      if (other.at >= v.at) continue
      if (overlap(me.summary, o.summary) >= 0.7 && value.sharesEntity(me, o)) {
        v.isRestatement = true
        v.restatementsOf = [other.id]
        v.why = [...(v.why || []), 'restatement']
        break
      }
    }
  }
  return verdicts
}
