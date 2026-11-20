// 图式偏差检测（F24、R6）：不符合图式的细节被“修正”时告警。
// biasFlag 与 evidenceFlag 是两个独立标记，不合并。
export function detect(candidate, existing) {
  if (!existing) return { bias: false }
  if (existing.state !== 'fact') return { bias: false }
  if (candidate.subject !== existing.subject) return { bias: false }
  if (candidate.predicate !== existing.predicate) return { bias: false }
  if (candidate.object === existing.object) return { bias: false }
  return { bias: true, reason: 'conflicts-with-fact', existingId: existing.id }
}

export function apply(cell, result = {}) {
  if (!result.bias) return cell
  cell.biasFlag = true
  cell.confidence = Math.max(0.05, (cell.confidence || 0.5) * 0.8)
  return cell
}
