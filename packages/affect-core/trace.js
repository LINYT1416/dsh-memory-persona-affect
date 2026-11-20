// 心跳轨迹：出问题靠它，不靠猜。
// 只留最近 N 次，内存里，不落盘（落盘的是 state 和 journal）。

export function createTrace(limit = 60) {
  const entries = []
  const byId = new Map()

  function record(entry) {
    entries.push(entry)
    byId.set(entry.txId, entry)
    while (entries.length > limit) {
      const dropped = entries.shift()
      byId.delete(dropped.txId)
    }
    return entry
  }

  return {
    record,
    get: (txId) => byId.get(txId) || null,
    list: (n = 20) => entries.slice(-n),
    latest: () => entries[entries.length - 1] || null,
    size: () => entries.length,
  }
}
