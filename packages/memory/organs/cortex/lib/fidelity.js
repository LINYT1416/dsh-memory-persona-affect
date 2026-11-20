// 保真度演化（F32）：原文降权、摘要升权；不追求永久保真。
export const SEMANTIC_RISE = 1.01
export const EPISODIC_FALL = 0.995

export function evolveWeight(weight, cell) {
  const factor = cell.layer === 'episodic' ? EPISODIC_FALL : SEMANTIC_RISE
  return weight * factor
}

/** 保真度：情景 1.0，语义随证据升，推断最低。 */
export function fidelityOf(cell) {
  if (cell.layer === 'episodic') return 1
  if (cell.source === 'hypothesis') return 0.3
  if (cell.source === 'stated') return Math.min(0.95, 0.6 + 0.1 * (cell.evidenceCount || 1))
  return Math.min(0.8, 0.45 + 0.1 * (cell.evidenceCount || 1))
}
