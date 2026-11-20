// 证据链（F25）：每条语义能追溯到支撑它的情景 id。
// 证据是“独立的”才算新证据（R23：同一 episode 版本不重复计数）。
export function addSupport(cell, id) {
  if (!id) return false
  if (cell.supportIds?.includes(id)) return false
  cell.supportIds = [...(cell.supportIds || []), id]
  cell.evidenceCount = cell.supportIds.length
  return true
}

export function evidenceCount(cell) {
  return Math.max(1, cell.supportIds?.length || cell.evidenceCount || 1)
}

/** 两条证据是不是独立：不是同一个 episode，且时间隔开。 */
export function isIndependentEvidence(a, b, { minGapMs = 5 * 60 * 1000 } = {}) {
  if (!a || !b) return false
  if (a.episodeId && b.episodeId && a.episodeId === b.episodeId) return false
  const da = Number(a.at || a.start || 0)
  const db = Number(b.at || b.start || 0)
  if (da && db && Math.abs(da - db) < minGapMs) return false
  return true
}

/** 可追溯性：这条语义支持哪些情景（去重、保序）。 */
export function traceOf(cell) {
  return [...new Set(cell.supportIds || [])]
}
