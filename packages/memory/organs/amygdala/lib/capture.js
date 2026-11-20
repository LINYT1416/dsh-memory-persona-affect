// 标签-捕获：打标（tag）和捕获（capture）是两步，不是一步。
// 对应文档：4.2 四步机制。
// 对应功能总表：A2-3、A2-4、A2-5。

export const WINDOW_MS = 15 * 60 * 1000 // 15 分钟硬上限
export const CAPTURE_FACTOR = 1.2       // 被捕获的条目最多抬 20%
export const JOIN_GAP = 2               // 相邻 ≤2 条也算同窗

export function makeCapture(state) {
  if (!state.windows) state.windows = []
  if (!state.openWindow) state.openWindow = null

  /** 高唤醒触发：给触发者本人打标，同时开窗。 */
  function tag({ id, at = Date.now(), entities = [], session = 'unknown', strength = 0.8 } = {}) {
    closeWindow(at) // 不嵌套：先关上一个
    const win = {
      v: 1,
      id: `w_${at.toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
      session,
      openedAt: at,
      closedAt: null,
      triggerId: id,
      triggerEntities: [...new Set(entities)].slice(0, 12),
      members: [{ id, at, tagged: true }],
      strength: Number(strength) || 0.8,
    }
    state.openWindow = win
    state.windows.push(win)
    return win
  }

  /** 同窗内的其他条目被捕获。 */
  function capture({ id, at = Date.now(), entities = [], session = 'unknown' } = {}) {
    const win = state.openWindow
    if (!win) return null
    if (win.session !== session) return null
    if (at - win.openedAt > WINDOW_MS) {
      closeWindow(at)
      return null
    }
    if (win.members.some((m) => m.id === id)) return null

    const shared = (win.triggerEntities || []).filter((e) => entities.includes(e))
    const near = win.members.length - 1
    const allowed = shared.length > 0 || near <= JOIN_GAP
    if (!allowed) return null

    win.members.push({ id, at, tagged: false, shared: shared.length })
    return win
  }

  /** 关窗：超时或换会话时。返回关掉的窗。 */
  function closeWindow(now = Date.now()) {
    const win = state.openWindow
    if (!win) return null
    win.closedAt = now
    win.members = win.members.filter(Boolean)
    state.openWindow = null
    return win
  }

  /** 某个 id 应该拿到的加权系数：源头 1.0，被捕获的按强度算。 */
  function factorOf(id, now = Date.now()) {
    for (const win of state.windows) {
      const m = win.members.find((x) => x.id === id)
      if (!m) continue
      if (m.tagged) return 1
      const decay = Math.max(0.4, 1 - (now - Number(m.at)) / WINDOW_MS)
      return Number((1 + (CAPTURE_FACTOR - 1) * decay * (win.strength || 0.8)).toFixed(4))
    }
    return 1
  }

  /** 清理老窗，防止无限涨。 */
  function sweep(now = Date.now(), keepMs = 24 * 60 * 60 * 1000) {
    const cut = now - keepMs
    state.windows = state.windows.filter((w) => Number(w.openedAt) >= cut)
    if (state.openWindow && now - state.openWindow.openedAt > WINDOW_MS) closeWindow(now)
    return state.windows.length
  }

  return { tag, capture, closeWindow, factorOf, sweep, get open() { return state.openWindow } }
}
