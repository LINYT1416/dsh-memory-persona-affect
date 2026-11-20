// 回执对账：我怎么知道自己的分被用了。
// 对应功能总表：A8-2、R15。
//
// 没有这个，接进来了也永远不知道有没有生效。

export const TOLERANCE = 0.2 // 允许 depth 差一档以内的波动

const DEPTH_RANK = { shallow: 0, standard: 1, deep: 2 }

/**
 * 对账：我给的档位 vs 实际落的档位。
 * 只报警，不自动改分（R15）——否则一个 bug 会污染分布。
 */
export function reconcile(given, actual, { at = Date.now() } = {}) {
  if (!given || !actual) return { mismatch: false, reason: 'missing' }
  const g = DEPTH_RANK[given.depth] ?? 0
  const a = DEPTH_RANK[actual.depth] ?? 0
  const diff = Math.abs(g - a)
  const scoreDelta = Math.abs(Number(given.score || 0) - Number(actual.score || 0))
  const mismatch = diff >= 2 || scoreDelta > TOLERANCE
  return {
    v: 1,
    at,
    mismatch,
    expected: { depth: given.depth, score: Number(given.score || 0) },
    actual: { depth: actual.depth, score: Number(actual.score || 0) },
    diff,
    scoreDelta: Number(scoreDelta.toFixed(4)),
    why: mismatch
      ? diff >= 2 ? 'depth-jump' : 'score-drift'
      : 'ok',
  }
}

export function makeReceipt(state) {
  if (!state.receipts) state.receipts = []
  if (!state.receiptStats) state.receiptStats = { total: 0, mismatch: 0 }

  function record(given, actual, opts = {}) {
    const row = reconcile(given, actual, opts)
    state.receipts.push(row)
    if (state.receipts.length > 200) state.receipts.shift()
    state.receiptStats.total += 1
    if (row.mismatch) state.receiptStats.mismatch += 1
    return row
  }

  function stats() {
    const { total, mismatch } = state.receiptStats
    return {
      total,
      mismatch,
      rate: total ? Number((mismatch / total).toFixed(4)) : 0,
      last: state.receipts.slice(-3),
    }
  }

  return { record, stats }
}
