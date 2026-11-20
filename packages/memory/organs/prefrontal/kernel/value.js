// #P4 价值：权重读 / 价值评估 / 奖赏预期 / 自我参照 / 价值整合
// 硬边界：这里只出"代理值"，真的情绪权重只在杏仁核（F15）。代理值一律标 proxy。
import { goalFit, rewardCue, selfRef, overlap, clamp } from './text.js'

/** #P4-1 读权重：杏仁核不在就给 null（不是 0.5——0.5 会被当成真值）。 */
export function weightOf(cand, seam) {
  const w = seam?.weight?.(cand.episodeId)
  if (w === undefined || w === null) return { tri: 'absent', weight: null, proxy: false }
  if (w === 'unknown') return { tri: 'unknown', weight: null, proxy: false }
  return { tri: 'value', weight: Number(w.weight ?? w) || 0, proxy: false }
}

/** #P4-5 价值评估：目标相关 + 得失词。 */
export function goalFitOf(cand, goal) {
  if (!goal) return { value: 0.5, proxy: true, why: '无目标' }
  const fit = goalFit(`${cand.summary} ${(cand.entities || []).join(' ')}`, goal)
  return { value: clamp(fit), proxy: true, why: '目标相关度' }
}

/** #P4-6 奖赏预期。 */
export function rewardOf(cand) {
  const v = rewardCue(cand.summary)
  return { value: v ? 0.8 : 0.5, proxy: true, why: v ? '有期待/达成词' : '中性' }
}

/** #P4-7 自我参照。 */
export function selfOf(cand) {
  const v = selfRef(cand.summary)
  return { value: v ? 0.75 : 0.5, proxy: true, why: v ? '与我相关' : '第三人称' }
}

/**
 * #P4-8 价值整合：多源合成**一个**数。
 * 不许并列输出两个分——那等于把矛盾丢给下游。
 */
export function integrate(parts = {}) {
  const w = []
  if (Number.isFinite(parts.weight)) w.push({ name: 'amy', value: clamp(parts.weight), w: 0.4 })
  if (Number.isFinite(parts.goal)) w.push({ name: 'goal', value: clamp(parts.goal), w: 0.3 })
  if (Number.isFinite(parts.reward)) w.push({ name: 'reward', value: clamp(parts.reward), w: 0.15 })
  if (Number.isFinite(parts.self)) w.push({ name: 'self', value: clamp(parts.self), w: 0.15 })
  if (!w.length) return { value: 0.5, parts: [], proxy: true }
  const total = w.reduce((n, x) => n + x.w, 0)
  const value = w.reduce((n, x) => n + x.value * x.w, 0) / total
  return { value: Number(value.toFixed(4)), parts: w, proxy: !Number.isFinite(parts.weight) }
}

/**
 * 排序用的价值乘子。范围 0.85–1.15：价值能影响顺序，但压不过相关性（否则就是情绪绑架）。
 */
export function bias(parts) {
  const { value } = integrate(parts)
  return { mult: Number((0.85 + value * 0.3).toFixed(4)), value }
}

/** 候选之间是否有共同实体（给"多线索归并"用）。 */
export function sharesEntity(a, b) {
  return (a.entities || []).some((e) => (b.entities || []).includes(e))
}

export function summaryOverlap(a, b) {
  return overlap(a.summary || '', b.summary || '')
}
