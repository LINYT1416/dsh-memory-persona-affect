// 稀疏度（F07）：容量/泛化/干扰的旋钮。
// 维度高、稀疏低 → 容量大、干扰小、泛化差；反过来泛化好但易灾难性干扰。
export const DEFAULT_SPARSITY = {
  topK: 12,
  threshold: 0.05,
}

/** 从 [id, score] 里挑出稀疏激活集。 */
export function select(entries, { topK = DEFAULT_SPARSITY.topK, threshold = DEFAULT_SPARSITY.threshold } = {}) {
  return entries
    .filter(([, score]) => score >= threshold)
    .sort((a, b) => b[1] - a[1])
    .slice(0, topK)
}

/** 稀疏度 = 激活数 / 总量。 */
export function sparsityOf(active, total) {
  if (!total) return 1
  return 1 - Math.min(1, active / total)
}
