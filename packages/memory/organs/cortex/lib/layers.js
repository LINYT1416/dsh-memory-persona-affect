// 分层（F26）：情景层不可改写，语义层可更新，推断层低置信。
// 情景永远来自海马体，皮层只读（R14）。
export const LAYERS = ['episodic', 'semantic', 'inference']

export function isImmutable(cell) {
  return cell.layer === 'episodic'
}

export function canRewrite(cell) {
  return !isImmutable(cell)
}

export function layerOf(source) {
  if (source === 'stated') return 'semantic'
  if (source === 'hypothesis') return 'inference'
  return 'inference'
}

export function partitionByLayer(cells) {
  const out = { episodic: [], semantic: [], inference: [] }
  for (const c of cells) (out[c.layer] || out.inference).push(c)
  return out
}
