// 低学习率 + 权重更新顺序（F09、C1、R3、R5）。
// 核心约束：一次对话不改写长期记忆；每次只改相关条目，小步长。
import { clamp } from './util.js'
import { applyLtd } from './ltd.js'
import { applyLtp } from './ltp.js'
import { evolveWeight } from './fidelity.js'

export const WEIGHT_MIN = 0.05
export const WEIGHT_MAX = 1.5

/** R3 固定顺序：LTD 衰减 → LTP 加成 → 保真度演化 → 冷热系数。
 *  每次都从基准 1 重算，避免多次蒸馏复利叠加。 */
export function applyWeights(cell, { now = Date.now(), tier = 'hot' } = {}) {
  let w = 1
  w = applyLtd(w, cell.lastSeen, now)   // 1
  w = applyLtp(w, cell.evidenceCount)   // 2
  w = evolveWeight(w, cell)             // 3
  if (tier === 'cold') w *= 0.85        // 4
  cell.weight = clamp(w, WEIGHT_MIN, WEIGHT_MAX)
  return cell.weight
}

/** 低学习率：证据越多，单次新增的步长越小（饱和）。 */
export function stepFor(evidenceCount = 1) {
  return clamp(0.1 / (1 + Math.max(0, evidenceCount - 1) * 0.5), 0.01, 0.1)
}

/** F23 图式加速只降“新建门槛”，不提高已有权重的步长（R5）。 */
export function entryThreshold(base = 0.55, { schemaMatch = false } = {}) {
  return schemaMatch ? base * 0.7 : base
}

/** 显著性调制学习率：杏仁核给分，缺了就用规则分。 */
export function salienceBoost(salience = 0.5) {
  return 0.8 + 0.4 * clamp(salience, 0, 1)
}
