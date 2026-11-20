// 重叠与干扰（F06）：相似概念共享特征，既是泛化基础，也是干扰源。
import { clamp, similarity } from './util.js'

export function overlapScore(a, b) {
  const A = new Set(a.featureIds || [])
  const B = new Set(b.featureIds || [])
  if (!A.size || !B.size) return 0
  let inter = 0
  for (const x of A) if (B.has(x)) inter += 1
  return inter / (A.size + B.size - inter)
}

/** 干扰度：特征重叠高但结论不同的两条，互相干扰。 */
export function interference(a, b) {
  const ov = overlapScore(a, b)
  if (ov < 0.3) return 0
  const sameObject = String(a.object || '') === String(b.object || '')
  return sameObject ? ov * 0.2 : ov
}

/** 找出一批 cell 里互相干扰的对。 */
export function findInterference(cells, threshold = 0.45) {
  const out = []
  for (let i = 0; i < cells.length; i++) {
    for (let j = i + 1; j < cells.length; j++) {
      const score = Math.max(interference(cells[i], cells[j]), similarity(cells[i].text, cells[j].text) * 0.6)
      if (score >= threshold) out.push({ a: cells[i].id, b: cells[j].id, score: clamp(score, 0, 1) })
    }
  }
  return out.slice(0, 20)
}
