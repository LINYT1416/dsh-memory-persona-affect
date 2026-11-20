// 索引退场（F34、R10、R15）：held → shadowed → retired。
// 皮层只能把自己这一侧的条目降档；retired 要外部接管信号，不自己退。
export const STATES = ['held', 'shadowed', 'retired']

export function nextState(current, { handoffOk = false } = {}) {
  if (current === 'retired') return 'retired'
  if (handoffOk) return 'retired'
  if (current === 'held') return 'shadowed'
  return current
}

export function applyRetirement(cell, { handoffOk = false } = {}) {
  cell.transferState = nextState(cell.transferState || 'held', { handoffOk })
  return cell.transferState
}
