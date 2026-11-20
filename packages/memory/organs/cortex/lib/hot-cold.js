// 冷热分层（F31、C5、R16）：近期热存，远期冷存；归档不删，可恢复。
export const HOT_DAYS = 30

export function tierOf(cell, now = Date.now()) {
  const days = (now - Number(cell.lastSeen || 0)) / 86400000
  return days <= HOT_DAYS ? 'hot' : 'cold'
}

export function refreshTier(cell, now = Date.now()) {
  cell.tier = tierOf(cell, now)
  return cell.tier
}

/** 冷且没证据的条目归档（不删，只标）。 */
export function archiveCold(cells, now = Date.now()) {
  const archived = []
  for (const c of cells) {
    if (c.archived || c.retracted) continue
    if (tierOf(c, now) === 'cold' && (c.confidence || 0) < 0.5 && (c.evidenceCount || 1) < 2) {
      c.archived = true
      archived.push(c.id)
    }
  }
  return archived
}

export function restore(cell) {
  cell.archived = false
  cell.tier = 'hot'
  cell.lastSeen = Date.now()
  // 以前这里只清 archived：被"纠错"过的条目（retracted + state='retracted'）
  // 调用 restore 也照样搜不到——接口返回 {restored:true}，实际什么都没恢复。
  // 撤销纠错要把它从 retracted 里救回来：退回假设态，置信度回一个能再被验证的值。
  if (cell.retracted || cell.state === 'retracted') {
    cell.retracted = false
    if (cell.state === 'retracted') cell.state = 'hypothesis'
    cell.confidence = Math.max(Number(cell.confidence) || 0, 0.6)
    cell.tags = (Array.isArray(cell.tags) ? cell.tags : []).filter((t) => t !== 'corrected')
  }
  return cell
}
