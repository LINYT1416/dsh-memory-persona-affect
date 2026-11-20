// STDP（F12）：谁先谁后决定增强还是削弱。
export const STDP_WINDOW_MS = 60 * 60 * 1000 // 一小时内才算“同一段时序”

/** 前→后：增强；后→前：削弱。返回乘子。 */
export function stdpDelta(prevAt, nextAt) {
  const dt = Number(nextAt) - Number(prevAt)
  if (!Number.isFinite(dt) || Math.abs(dt) > STDP_WINDOW_MS) return 1
  if (dt >= 0) return 1 + 0.1 * Math.min(1, dt / STDP_WINDOW_MS + 0.3)
  return 1 - 0.1 * Math.min(1, Math.abs(dt) / STDP_WINDOW_MS + 0.3)
}

/** 给一批按时间排好的条目写相对顺序（order）。 */
export function assignOrder(items) {
  const sorted = [...items].sort((a, b) => (a.at || 0) - (b.at || 0))
  sorted.forEach((it, i) => { it.order = i })
  return sorted
}

export function applyStdp(weight, prevAt, nextAt) {
  return Math.max(0.1, weight * stdpDelta(prevAt, nextAt))
}
