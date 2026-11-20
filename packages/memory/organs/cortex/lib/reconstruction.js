// 重建标记（F29、R8）：每次提取都是重建，标记污染度，不影响本体权重。
export const RECONSTRUCT_PENALTY = 0.9

export function makeTrace({ cellId, query = '', context = {}, at = Date.now() } = {}) {
  return {
    at,
    cellId,
    query,
    context,
    reconstructed: true,
    confidence: RECONSTRUCT_PENALTY,
  }
}

/** 重建后的展示置信度：只作用在这条 trace 上。 */
export function traceConfidence(cell, trace) {
  const base = Number(cell.confidence ?? 0.5)
  return Math.max(0, Math.min(1, base * (trace?.confidence ?? RECONSTRUCT_PENALTY)))
}
