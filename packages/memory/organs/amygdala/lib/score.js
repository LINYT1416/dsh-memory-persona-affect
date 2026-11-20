// 打分：六因子 + 时间临近 + 合成 + 标定 + 倒 U。
// 对应文档：4.2 标签-捕获入口、剂量效应。
// 对应功能总表：A1-1 ~ A1-7、R1、R10、R11。

import {
  parseSelf, parseOther, arousalOf, extremeOf, stakeOf, clamp,
} from './emotion.js'
import {
  FACTORS, BASE, NEG_BIAS, SELF_WEIGHT, compose, calibrate, explain, clamp01,
} from './weights.js'
import { threatOf, trustOf } from './social.js'
import { modulateOf } from './modulate.js'

export const RING_MAX = 60
export const SAMPLES_MAX = 200

/**
 * 测试数据识别：这类东西不该进真实记忆，更不该排在真事前面。
 * 打上 test 标签，下游（海马/前额叶）可以据此隔离。
 */
export function isTestText(text) {
  const s = String(text || '').trim()
  if (!s) return false
  return /^【?链路测试|^测试[：:]|^\[?test[\]：:]|可删|落账验证|^\s*TEST\b/i.test(s)
}

/**
 * 时间戳归一。注意 at=0 是合法值（测试会用），
 * 不能用 `at || Date.now()` —— 0 是 falsy，会被当成"没传"。
 */
export function atOf(v, fallback = Date.now()) {
  if (v === undefined || v === null || v === '') return fallback
  const n = Number(v)
  return Number.isFinite(n) ? n : fallback
}

// ── 词表 ──────────────────────────────────────────────────────
const EXPLICIT_RE = /记住|别忘|一定|务必|答应|约好|承诺|以后都|记一下|别忘了/
// 身份/职责类事实。之前只认 uid/生日，导致"我叫示例用户""这窗口的职责是…"
// 这种最该记住的话只有 0.28（shallow）——纯属词表漏了。
const IDENTITY_RE = /uid|账号|帐号|号码|生日|邮箱|身份证|住在|老家|名字|昵称|过敏|手机号|地址|我叫|叫(?!我|他|她|你|去|来|醒|住|做|得|上)[\u4e00-\u9fa5]{2,4}|专业|学校|学院|大学|职业|岗位|职责|负责|在意|约定|规矩|原则/i
const CHITCHAT_RE = /^(嗯+|哦+|好+|行+|可以|收到|ok|OK|在吗|早|晚安|哈哈哈*)[啊呀呢吧〜~！!。.…]*$/

// 时间词：近的高，远的零
const NEAR_RE = /明天|明早|明晚|后天|今晚|今早|待会|一会儿|马上|下周|下周[一二三四五六日]|月底|截止|还有\s*\d+\s*天|\d+\s*天后|快到了|这两天|天亮/
const FAR_RE = /昨天|前天|上周|上个月|去年|上次|以前|小时候/

/** 实体抽取：轻量版。够算重复和新颖，不做语义。 */
export function entitiesOf(text, limit = 10) {
  const s = String(text || '')
  // 中英混排归一：把 "B 站" 合成 "B站"。
  // 不合成的话，"B" 太短被丢、"站" 是单字被丢，两边都抽不到。
  const norm = s.replace(/([A-Za-z])\s+(?=[\u4e00-\u9fa5])/g, '$1')
  const bag = new Map()
  const bump = (w, n = 1) => {
    if (!w) return
    const k = w.toLowerCase()
    bag.set(k, (bag.get(k) || 0) + n)
  }
  // 中英混排词：B站 / QQ机器人 / Edge TTS 这类。
  // 长串贪婪会吞掉后面的字（"B站智能回"），所以同时收一个短版（"B站"），
  // 检索和 subject 匹配要的是短版。
  for (const m of norm.matchAll(/[A-Za-z]{1,4}[\u4e00-\u9fa5]{1,4}/g)) {
    bump(m[0], 3)
    const short = m[0].match(/^[A-Za-z]{1,4}[\u4e00-\u9fa5]/)?.[0]
    if (short && short !== m[0]) bump(short, 2)
  }
  for (const m of norm.matchAll(/@([^\s@]{1,20})/g)) bump(m[1], 3)
  for (const m of norm.matchAll(/#([^\s#]{1,20})/g)) bump(m[1], 3)
  for (const m of norm.matchAll(/[「『"“]([^」』"”]{1,20})[」』"”]/g)) bump(m[1], 2)
  for (const m of norm.matchAll(/\d{4,}/g)) bump(m[0], 3)
  for (const m of norm.matchAll(/[A-Za-z][A-Za-z0-9_.+-]{1,}/g)) bump(m[0], 2)
  const han = norm.replace(/[^\u4e00-\u9fa5]+/g, ' ')
  for (const seg of han.split(' ')) {
    if (seg.length < 2) continue
    if (seg.length <= 4) {
      bump(seg)
      continue
    }
    for (let i = 0; i < seg.length - 1; i++) bump(seg.slice(i, i + 2))
  }
  return [...bag.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([w]) => w)
    .filter((w) => w.length >= 2)
    .slice(0, limit)
}

function jaccard(a = [], b = []) {
  const A = new Set(a)
  const B = new Set(b)
  if (!A.size && !B.size) return 1
  let inter = 0
  for (const x of A) if (B.has(x)) inter += 1
  const union = A.size + B.size - inter
  return union ? inter / union : 0
}

export function makeScorer({ state, switches, audit } = {}) {
  if (!state) throw new Error('scorer needs state')
  if (!state.ring) state.ring = []
  if (!state.samples) state.samples = []
  if (!state.episodeWeights) state.episodeWeights = new Map()
  if (!state.scoreIndex) state.scoreIndex = new Map()
  if (!state.counters) state.counters = { scored: 0, extreme: 0, threatHits: 0, conflict: 0, review: 0 }

  // ── 因子 ──────────────────────────────────────────────────

  /** 时间临近（A1-2）：文档列的五个来源之一，之前漏了。 */
  function proximityOf(text) {
    const s = String(text || '')
    if (NEAR_RE.test(s)) {
      // 越短越急：带"还有 X 天"的直接算
      const m = s.match(/还有\s*(\d+)\s*天/)
      if (m) {
        const d = Number(m[1])
        return d <= 3 ? FACTORS.proximity : d <= 7 ? FACTORS.proximity * 0.5 : 0
      }
      return FACTORS.proximity
    }
    if (FAR_RE.test(s)) return 0
    return 0
  }

  /** 重复（A1-1）：同实体 7 天内出现次数。 */
  function repeatOf(entities, now) {
    const cut = now - 7 * 24 * 60 * 60 * 1000
    const recent = state.ring.filter((r) => Number(r.at) >= cut)
    if (!recent.length || !entities.length) return { score: 0, n: 0 }
    let hit = 0
    for (const r of recent) {
      if ((r.entities || []).some((e) => entities.includes(e))) hit += 1
    }
    if (hit < 3) return { score: 0, n: hit }
    return { score: Math.min(FACTORS.repeat, 0.05 * (hit - 2)), n: hit }
  }

  /** 具体度：有数字/时间/地点/长度。情景细节越足，越可能"这件事发生过"。 */
  function detailOf(text) {
    const s = String(text || '')
    let d = 0
    if (/\d|[一二三四五六七八九十]{1,3}点/.test(s)) d += 0.04
    if (/早上|晚上|下午|中午|凌晨|下班|上班|楼下|公司|家里|地铁|超市|食堂|医院|学校|路上|房间|工位/.test(s)) d += 0.03
    if (s.length >= 25) d += 0.03
    return Number(Math.min(FACTORS.detail, d).toFixed(4))
  }

  /** 新颖（R10：跟重复互斥，一个高另一个必为 0）。做成连续值，别一刀切。 */
  function noveltyOf(entities) {
    const recent = state.ring.slice(-20)
    if (!recent.length) return { score: FACTORS.novelty, sim: 0 }
    const last = recent[recent.length - 1]?.entities || []
    const sim = jaccard(entities, last)
    const score = sim < 0.2
      ? Number((FACTORS.novelty * (1 - sim / 0.2)).toFixed(4))
      : 0
    return { score, sim: Number(sim.toFixed(3)) }
  }

  /** 目标相关：跟 ctx.goals 的词重合。 */
  function goalOf(text, goals = []) {
    if (!goals.length) return 0
    const s = String(text || '')
    let n = 0
    for (const g of goals) {
      const words = String(g).split(/[\s,，、]+/).filter((w) => w.length >= 2)
      for (const w of words) if (s.includes(w)) n += 1
    }
    return n ? FACTORS.goal : 0
  }

  /** 情绪因子：命中情绪词。arousal 太低就不给分，别让每句话都蹭到 0.04。 */
  function emotionFactor(polarity, arousal) {
    if (!arousal || arousal < 0.2) return 0
    return Math.min(FACTORS.emotion, arousal * 0.25 + Math.abs(polarity) * 0.1)
  }

  // ── 主路径 ────────────────────────────────────────────────

  /**
   * 快路：同步、不 await、预算 5ms。
   * 只读 ctx 里已有的东西，绝不回头调检索（P7）。
   */
  function scoreFast(ctx = {}) {
    const now = atOf(ctx.at)
    const text = String(ctx.text || '')
    const degraded = []

    // 前额叶短路（A8-4）：说别记，就不算了
    if (ctx.preVerdict && ctx.preVerdict.remember === false) {
      return {
        v: 1,
        score: 0,
        rank: 0,
        raw: 0,
        shortCircuit: true,
        why: ctx.preVerdict.why || 'preVerdict',
        modulators: modulateOf(0),
        components: {},
        reasons: ['被前额叶拦下'],
        tags: [],
        degraded: ['short-circuit'],
        source: 'amygdala@fast',
      }
    }

    const self = parseSelf(text)
    const other = parseOther(text)
    const danger = threatOf(text)
    const trust = trustOf(ctx.source || {})
    const selfArousal = Number.isFinite(Number(ctx.arousal)) ? clamp01(ctx.arousal) : self.arousal
    const selfPolarity = Number.isFinite(Number(ctx.polarity)) ? clamp(ctx.polarity, -1, 1) : self.polarity
    // 被骂/被针对时，情绪信号在**对方**身上（parseOther 抓到了 angry），
    // 自己那句话里没有情绪词。以前只用 self 的唤醒度算情绪因子，
    // 于是"你这个废物，滚吧"和"今天天气不错"同分 0.3——只有 reasons 多一行，
    // 分数一点没动。对方带怒意/厌恶，对"我"就是负面刺激，要计进唤醒与极性。
    const otherNeg = Boolean(other.top) && ['angry', 'disgust', 'sad'].includes(other.top)
    const arousal = otherNeg ? Math.max(selfArousal, 0.55) : selfArousal
    const polarity = otherNeg ? Math.min(selfPolarity, -0.25) : selfPolarity
    const extreme = extremeOf(arousal)

    const entities = [...new Set([...(ctx.entities || []), ...entitiesOf(text)])].slice(0, 12)

    if (!text) degraded.push('empty-text')
    if (!trust.why) degraded.push('no-source')

    // 因子累加
    const components = {}
    let raw = BASE

    if (EXPLICIT_RE.test(text)) {
      components.explicit = FACTORS.explicit
      raw += FACTORS.explicit
    }
    if (IDENTITY_RE.test(text)) {
      components.identity = FACTORS.identity
      raw += FACTORS.identity
    }

    const emo = emotionFactor(polarity, arousal)
    if (emo > 0) {
      components.emotion = emo
      raw += emo * (polarity < 0 ? NEG_BIAS : 1)
    }

    // 具体度：把"有细节的事"和"干巴巴一句话"拉开
    const detail = detailOf(text)
    if (detail > 0) {
      components.detail = detail
      raw += detail
    }

    // 利害（A1-8）：威胁到生存/位置/关系的，神经系统一定给高分。
    // 没有这一条，"要被裁员"会跟"明早买包子"同分。
    const stake = stakeOf(text)
    if (stake.score > 0) {
      components.stake = stake.score
      raw += stake.score
      degraded.push(`stake:${stake.level}`)
    }

    const rep = repeatOf(entities, now)
    const nov = noveltyOf(entities)
    // R10：互斥
    if (rep.score > 0) {
      components.repeat = rep.score
      raw += rep.score
    } else if (nov.score > 0) {
      components.novelty = nov.score
      raw += nov.score
    }

    const goal = goalOf(text, ctx.goals || [])
    if (goal > 0) {
      components.goal = goal
    }

    const prox = proximityOf(text)
    // R11：时间临近 + 目标相关合计上限 0.2
    const pair = Math.min(0.2, goal + prox)
    if (goal + prox > 0) {
      const scale = (goal + prox) > 0 ? pair / (goal + prox) : 0
      if (goal > 0) components.goal = Number((goal * scale).toFixed(4))
      if (prox > 0) components.proximity = Number((prox * scale).toFixed(4))
      raw += pair
    }

    // 寒暄：减分
    if (CHITCHAT_RE.test(text.trim())) {
      components.chitchat = -0.2
      raw -= 0.2
    }

    // 倒 U（A1-7）：只降一点点，细节另算
    if (extreme.extreme) {
      raw += extreme.salDelta
      degraded.push('extreme-arousal')
    }

    const rawClamped = clamp01(raw)

    // 合成：我只投一票（A1-3）
    const votes = [
      { score: rawClamped, weight: SELF_WEIGHT, source: 'amygdala' },
      ...(Array.isArray(ctx.others) ? ctx.others : []),
    ]
    const composed = compose(votes)

    // 标定：绝对分给调制，排名给展示（A1-4 / R1）
    const cal = calibrate(composed.score, state.samples)

    // 只在最后乘 tone，且不进标定池（R1）
    const gain = toneGainAt(now)
    const captureFactor = captureFactorAt(ctx.id, now)
    const final = clamp01(cal.score * gain * captureFactor)

    const modulators = modulateOf(final, { extreme: extreme.extreme })

    // 证据
    const reasons = explain(components)
    if (extreme.extreme) reasons.push('极端唤醒：细节记不牢')
    if (other.top) reasons.push(`对方像是${other.top}`)

    const tags = []
    if (extreme.extreme) tags.push('extreme')
    if (composed.spread > 0.25) tags.push('contested')
    // 测试数据：标出来，别让它混进真实检索
    if (isTestText(text)) {
      tags.push('test')
      degraded.push('test-data')
    }

    return {
      v: 1,
      score: Number(final.toFixed(4)),
      rank: Number(cal.rank.toFixed(4)),
      raw: Number(rawClamped.toFixed(4)),
      components,
      reasons,
      modulators,
      tags,
      entities,
      polarity: Number(polarity.toFixed(3)),
      arousal: Number(arousal.toFixed(3)),
      category: self.category,
      other: other.top ? { top: other.top, confidence: other.confidence } : null,
      vividness: Number(clamp01(arousal * 0.7 + (extreme.extreme ? 0.3 : 0)).toFixed(3)),
      threat: danger.level,
      trust: trust.value,
      confidenceHint: Number(clamp01(trust.value * (1 + (extreme.extreme ? extreme.confDelta : 0))).toFixed(3)),
      details: extreme.details,
      calibration: { mode: cal.mode, n: cal.n },
      degraded: [...new Set([...degraded, ...self.degraded, ...other.degraded, ...composed.degraded, ...cal.degraded])],
      source: 'amygdala@fast',
      at: now,
    }
  }

  /**
   * 慢路：异步补精。优先用皮层给的精细输入（M1 修正）。
   * 不覆盖已落盘的分数，只出"建议"（R13）。
   */
  function scoreSlow(ctx = {}) {
    const fast = scoreFast(ctx)
    const fine = ctx.fine && typeof ctx.fine === 'object' ? ctx.fine : null
    const slowSource = fine ? 'cortex' : 'rule'

    if (!fine) {
      // 没有皮层，就用同一套规则再算一遍，但标清楚
      return { ...fast, source: 'amygdala@slow', slowSource, note: '无皮层输入，规则重算' }
    }

    const entities = [...new Set([...(fine.entities || []), ...(fast.entities || [])])]
    const components = { ...fast.components }
    let bonus = 0
    // 皮层说"这是身份事实/承诺" → 补权重
    if (fine.kind === 'identity') bonus += 0.1
    if (fine.kind === 'commitment') bonus += 0.1
    if (fine.intent === 'ask-about-self') bonus += 0.05
    if (bonus > 0) components.fineBonus = Number(bonus.toFixed(4))

    const score = clamp01(fast.score + bonus)
    return {
      ...fast,
      score: Number(score.toFixed(4)),
      components,
      modulators: modulateOf(score, { extreme: fast.tags.includes('extreme') }),
      source: 'amygdala@slow',
      slowSource,
      note: '慢路只出建议，不覆盖已落盘分数（R13）',
      entities,
    }
  }

  // ── 外部依赖的可选钩子（拿不到就降级） ──────────────────────

  function toneGainAt(now) {
    if (!state.toneHook) return 1
    try {
      return Number(state.toneHook(now)) || 1
    } catch {
      return 1
    }
  }

  function captureFactorAt(id, now) {
    if (!id || !state.captureHook) return 1
    try {
      return Number(state.captureHook(id, now)) || 1
    } catch {
      return 1
    }
  }

  // ── 记录 ──────────────────────────────────────────────────

  /** 写进 ring 和样本池。样本池只放裸分（R1）。 */
  function remember(result, ctx = {}) {
    const now = atOf(result.at)
    const entities = entitiesOf(ctx.text || '')
    state.ring.push({
      at: now,
      id: ctx.id || null,
      entities,
      score: Number(result.score) || 0,
      test: Boolean(result.tags?.includes('test')),
      polarity: result.polarity,
      arousal: result.arousal,
    })
    if (state.ring.length > RING_MAX) state.ring.splice(0, state.ring.length - RING_MAX)

    state.samples.push(Number(result.raw ?? result.score))
    if (state.samples.length > SAMPLES_MAX) {
      state.samples.splice(0, state.samples.length - SAMPLES_MAX)
    }

    state.counters.scored += 1
    if (result.tags?.includes('extreme')) state.counters.extreme += 1
    if (Number(result.threat) > 0) state.counters.threatHits += 1
    return state.counters
  }

  /**
   * 这条记忆现在多重（0..1）。前额叶的 value() 要用它，而且占 0.4 权重。
   * 三级回落：
   *   1. 海马体 episode 上的 salience（重启后还在，最可靠）
   *   2. 自己的 ring（刚打过的）
   *   3. 自己的 scores（有 id 的那部分）
   * 都没有就返回 null —— 前额叶会当 absent，不许用 0 顶替。
   */
  function weightOf(id) {
    if (!id) return null
    // 1. 自己刚算的（最新模型，优先）
    for (let i = state.ring.length - 1; i >= 0; i -= 1) {
      const r = state.ring[i]
      if (r.id && r.id === id && Number.isFinite(Number(r.score))) {
        return Number(r.score)
      }
    }
    // 2. 海马体 episode 上存的（历史值，重启后还在）
    const ep = state.episodeWeights?.get?.(id)
    if (Number.isFinite(Number(ep))) return Number(ep)
    // 3. 自己的 scores（有 id 的那部分）
    const own = state.scoreIndex?.get?.(id)
    if (own && Number.isFinite(Number(own.score))) return Number(own.score)
    return null
  }

  function stats() {
    const samples = state.samples
    const sorted = [...samples].sort((a, b) => a - b)
    const q = (p) => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))] : 0)
    const deep = state.ring.filter((r) => r.score >= 0.65).length
    return {
      scored: state.counters.scored,
      extreme: state.counters.extreme,
      threatHits: state.counters.threatHits,
      samples: samples.length,
      p10: Number(q(0.1).toFixed(3)),
      p50: Number(q(0.5).toFixed(3)),
      p90: Number(q(0.9).toFixed(3)),
      deepRatio: state.ring.length ? Number((deep / state.ring.length).toFixed(3)) : 0,
      ring: state.ring.length,
    }
  }

  return { score: scoreFast, scoreFast, scoreSlow, remember, stats, weightOf, entitiesOf, proximityOf }
}
