// 写窗口（F15）：SO 的 up state 才可写；忙的时候只缓冲、不落语义（R1）。
export const BUSY_MS = 3 * 60 * 1000

export function isBusy(lastActivityAt, now = Date.now()) {
  return Boolean(lastActivityAt) && now - lastActivityAt < BUSY_MS
}

/** 可以巩固写入吗：不忙 + 有安静窗口。 */
export function canWrite({ lastActivityAt = 0, now = Date.now(), minQuietMs = BUSY_MS } = {}) {
  return !lastActivityAt || now - lastActivityAt >= minQuietMs
}
