// 冲突记录（F45、C7）：新信息与旧信息冲突时标记，不覆盖（R20）。
import { appendJsonl, FILES } from './store.js'

export function makeConflict(a, b, reason = 'value-mismatch') {
  return {
    at: Date.now(),
    aId: a?.id || '',
    bId: b?.id || '',
    aText: a?.text || '',
    bText: b?.text || '',
    reason,
    state: 'open',
  }
}

export async function record(store, a, b, reason) {
  const conflict = makeConflict(a, b, reason)
  store.conflicts.push(conflict)
  await appendJsonl(FILES.conflicts, conflict)
  return conflict
}

export function list(store, limit = 20) {
  return store.conflicts.slice(-limit)
}

export function resolve(store, index, winner = 'neither') {
  const c = store.conflicts[index]
  if (!c) return null
  c.state = 'resolved'
  c.winner = winner
  c.resolvedAt = Date.now()

  const a = store.get(c.aId)
  const b = store.get(c.bId)
  const penalize = (cell) => {
    if (!cell) return
    cell.evidenceFlag = true
    cell.confidence = Math.max(0.05, (cell.confidence || 0.5) * 0.6)
    store.put(cell)
  }
  if (winner === 'a') penalize(b)
  else if (winner === 'b') penalize(a)
  else { penalize(a); penalize(b) }

  void appendJsonl(FILES.conflicts, c)
  return c
}
