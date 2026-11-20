// 图式匹配加速（F23、R5）：符合图式的新信息学得快。
// 只降“新建门槛”，不提高已有权重的步长。
import { similarity } from './util.js'

/** 一条候选和图式条目的匹配度。 */
export function matchScore(candidate, patterns = []) {
  let best = 0
  for (const p of patterns) {
    const s = similarity(candidate.text || '', p.text || '')
    if (s > best) best = s
  }
  return best
}

/** 匹配到图式 → 门槛打七折（由 learning.entryThreshold 统一管）。 */
export function boostedThreshold(base, score, { min = 0.5 } = {}) {
  return score >= min ? base * 0.7 : base
}
