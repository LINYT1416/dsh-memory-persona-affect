// 痕迹消费（F44）：读海马体 traces，算“被想起几次”。
// 海马体的 trace 是 episode 粒度；皮层用 supportIds 映射回 cell。
export async function read(adapters, { since = 0, limit = 500 } = {}) {
  if (adapters?.hippocampus?.traces) {
    try {
      const rows = await adapters.hippocampus.traces({ since, limit })
      if (Array.isArray(rows)) return rows
    } catch { /* 读不到就当没有 */ }
  }
  return []
}

/** cellId → 被想起次数（按 episodeId 命中 supportIds）。 */
export function counts(traceRows, cells) {
  const byEpisode = new Map()
  for (const t of traceRows) {
    const id = t.episodeId || t.id
    if (!id) continue
    byEpisode.set(id, (byEpisode.get(id) || 0) + 1)
  }
  const out = new Map()
  for (const c of cells) {
    let n = 0
    for (const s of c.supportIds || []) n += byEpisode.get(s) || 0
    if (n) out.set(c.id, n)
  }
  return out
}

/** 被想起次数 → 权重加成（封顶 1.5，由 learning 统一压）。 */
export function recallBoost(count = 0) {
  return Math.min(1.5, 1 + 0.05 * Math.max(0, count))
}
