// 三重耦合对齐（F17、R18）：SO up → SWR 到达 → 纺锤波尾部 → 突触修改。
// 工程上只要求“三个信号落在一个窗口内”，不要求频率。
export const SEQUENCE = ['so-up', 'swr', 'spindle']

export function aligned(events = []) {
  const kinds = events.map((e) => e?.kind).filter(Boolean)
  let i = 0
  for (const k of kinds) {
    if (k === SEQUENCE[i]) i += 1
    if (i === SEQUENCE.length) return true
  }
  return false
}

/** 一个窗口：默认 90 分钟（一个 NREM 周期的量级）。 */
export function windowOf(at, spanMs = 90 * 60 * 1000) {
  return { from: Number(at) - spanMs, to: Number(at) }
}

/** 批必须落在一个窗口内，跨窗口拆批（R18）。 */
export function splitByWindow(items, spanMs = 90 * 60 * 1000) {
  const out = []
  let cur = []
  for (const it of items) {
    const at = Number(it.at || it.start || 0)
    if (cur.length && at - Number(cur[0].at || cur[0].start || 0) > spanMs) {
      out.push(cur)
      cur = []
    }
    cur.push(it)
  }
  if (cur.length) out.push(cur)
  return out
}
