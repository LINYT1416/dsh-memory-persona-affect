// 分层可信度（F27）：事件 / 语义 / 推断三档。
// R7：confidence 是“真不真”，salience 是“重不重要”，两个字段不互乘。
import { clamp } from './util.js'

export const BASE = {
  stated: 0.9,
  inferred: 0.6,
  hypothesis: 0.3,
}

export function baseConfidence(source) {
  return BASE[source] ?? 0.5
}

export function tierOf(cell) {
  if (cell.layer === 'episodic') return 'event'
  if (cell.layer === 'semantic') return 'semantic'
  return 'inference'
}

/** 证据越多，置信度微升，但不越过来源的上限。 */
export function recompute(cell) {
  const base = baseConfidence(cell.source)
  const n = Math.max(1, cell.evidenceCount || 1)
  const gain = Math.min(0.08, 0.02 * (n - 1))
  cell.confidence = clamp(base + gain, 0, 0.98)
  return cell.confidence
}

/** 前额叶校验后校准（F36/F39 的后门）；没有校验就按规则。 */
export function calibrate(cell, { verifyScore = null } = {}) {
  if (typeof verifyScore === 'number') {
    cell.confidence = clamp((cell.confidence + verifyScore) / 2, 0, 0.98)
  }
  return cell.confidence
}
