// 权重表 + 合成器 + 标定。
// 对应功能总表：A1-1 多因子、A1-3 合成器、A1-4 标定、A2-6 负性偏置、R1、R10。
//
// 两条硬规矩：
//   1. 标定池只放**裸分**（不含 tone）。tone 只在最终输出乘（R1）。
//   2. 新颖性和重复互斥：一个高另一个必为 0（R10）。

export const FACTORS = {
  explicit: 0.30,   // 记住/别忘/一定
  identity: 0.40,   // uid/生日/账号 + 我叫X/专业/职责（身份事实最该记住）
  emotion: 0.25,    // 情绪词
  repeat: 0.15,     // 重复出现
  goal: 0.15,       // 目标相关
  novelty: 0.08,    // 新颖度
  proximity: 0.08,  // 时间临近
  stake: 0.34,      // 利害：威胁到生存/位置/关系
  detail: 0.10,     // 具体度：有数字/时间/地点/长度，情景细节越足越值得记
}

export const NEG_BIAS = 1.1
// 0.25 → 0.20 → 0.18 → 0.22：调到能让"有细节的日常"进 standard，又不至于全挤在 0.4
export const BASE = 0.22

/** 我这一票的权重：留 0.4 给别人投。 */
export const SELF_WEIGHT = 0.6

/** 标定阈值：样本少于这个数，只用绝对分。 */
export const CALIB_MIN = 200

export const clamp01 = (n) => Math.max(0, Math.min(1, Number(n) || 0))

/**
 * 合成器：多票加权。
 * votes = [{ score, weight, source }]
 * 方差大 = 多方意见不一致 → 轻微惩罚，别让冲突被平均掉。
 */
export function compose(votes, { penalty = true } = {}) {
  const list = (Array.isArray(votes) ? votes : []).filter(
    (v) => v && Number.isFinite(Number(v.score)) && Number(v.weight) > 0,
  )
  if (!list.length) return { score: 0.5, votes: 0, spread: 0, degraded: ['no-vote'] }

  let sum = 0
  let weight = 0
  for (const v of list) {
    sum += clamp01(v.score) * Number(v.weight)
    weight += Number(v.weight)
  }
  let score = weight > 0 ? sum / weight : 0.5

  const mean = score
  const spread = Math.sqrt(
    list.reduce((n, v) => n + (clamp01(v.score) - mean) ** 2, 0) / list.length,
  )
  if (penalty) score *= 1 - Math.min(0.15, spread * 0.3)

  return {
    score: Number(clamp01(score).toFixed(4)),
    votes: list.length,
    spread: Number(spread.toFixed(4)),
    degraded: list.length === 1 ? ['single-vote'] : [],
  }
}

/** 百分位：所有样本里有多少比例 <= x。 */
export function percentileOf(x, samples) {
  const arr = Array.isArray(samples) ? samples : []
  if (!arr.length) return 0.5
  let le = 0
  for (const s of arr) if (Number(s) <= x) le += 1
  return le / arr.length
}

/**
 * 标定：绝对分给调制，排名给展示。
 * 冷启动（样本 < 200）只用绝对分，否则 0.4 绝对 + 0.6 排名。
 * 返回两个值，**不许混用**（R1）。
 */
export function calibrate(raw, samples = [], { min = CALIB_MIN } = {}) {
  const abs = clamp01(raw)
  const n = Array.isArray(samples) ? samples.length : 0
  if (n < min) {
    return {
      score: Number(abs.toFixed(4)),
      rank: Number(abs.toFixed(4)),
      mode: 'abs',
      n,
      degraded: ['cold-start'],
    }
  }
  const pct = percentileOf(abs, samples)
  const mixed = 0.4 * abs + 0.6 * pct
  return {
    score: Number(clamp01(mixed).toFixed(4)),
    rank: Number(pct.toFixed(4)),
    mode: 'mixed',
    n,
    degraded: [],
  }
}

/** 因子表转成人话理由。 */
export function explain(components) {
  const out = []
  const names = {
    explicit: '显式强调',
    identity: '身份事实',
    emotion: '情绪',
    repeat: '反复出现',
    goal: '跟目标相关',
    novelty: '新东西',
    proximity: '时间临近',
    stake: '利害',
    detail: '细节',
  }
  for (const [k, v] of Object.entries(components || {})) {
    if (Number(v) > 0) out.push(`${names[k] || k}+${Number(v).toFixed(2)}`)
  }
  return out
}
