// #P0-2 容量双闸 / #P1-8 检索预算
// 两套数分开：条数与字符不互相换算（R14 的另一半）。
export const PROFILES = {
  // 快路：15ms 里能跑完的量
  fast: { rounds: 1, ms: 15, chars: 400, items: 5 },
  // 慢路：允许两轮
  slow: { rounds: 2, ms: 800, chars: 1200, items: 8 },
  // 注入块
  inject: { rounds: 0, ms: 5, chars: 900, items: 6 },
  // 离线
  offline: { rounds: 0, ms: 60000, chars: 200000, items: 200 },
}

export function cap(profile = 'fast', override = {}) {
  return { ...(PROFILES[profile] || PROFILES.fast), ...override }
}

/**
 * 双闸截断：先按档位（任务内 > 近期 > 背景），档内按分数。
 * R8：多任务时每个任务保底 minPerTask 条，不许一个任务吃光（没有 taskId 就按单任务处理）。
 * 返回被砍的，供记账（P5-4 账本 + 审计）。
 */
export function fit(items, { maxItems = 6, maxChars = 900, minPerTask = 2 } = {}) {
  const rank = { hot: 0, recent: 1, background: 2 }
  const sorted = [...(items || [])].sort((a, b) => {
    const da = rank[a.tier] ?? 3
    const db = rank[b.tier] ?? 3
    if (da !== db) return da - db
    return (b.score || 0) - (a.score || 0)
  })

  // 任务保底：先给每个任务发 minPerTask 张票
  const byTask = new Map()
  for (const it of sorted) {
    const k = it.taskId || '__single__'
    const list = byTask.get(k) || []
    list.push(it)
    byTask.set(k, list)
  }
  const reserved = new Set()
  for (const list of byTask.values()) {
    for (const it of list.slice(0, minPerTask)) reserved.add(it)
  }

  const kept = []
  const dropped = []
  let chars = 0
  const ordered = [...sorted.filter((i) => reserved.has(i)), ...sorted.filter((i) => !reserved.has(i))]
  for (const it of ordered) {
    const len = String(it.summary || '').length
    if (kept.length >= maxItems || chars + len > maxChars) {
      dropped.push({ ...it, droppedBy: kept.length >= maxItems ? 'items' : 'chars' })
      continue
    }
    kept.push(it)
    chars += len
  }
  return { kept, dropped, chars, truncated: dropped.length > 0, tasks: byTask.size }
}

export function remaining(startMs, budgetMs) {
  return Math.max(0, budgetMs - (Date.now() - startMs))
}

/** 预算紧时的砍法：先砍背景档内容，绝不砍置信与来源标记（R14）。 */
export function trimForBudget(parts, { maxChars = 900 } = {}) {
  const keep = []
  let n = 0
  for (const p of parts) {
    const s = String(p?.text ?? '')
    if (n + s.length > maxChars && p?.essential !== true) continue
    keep.push(p)
    n += s.length
  }
  return { kept: keep, chars: n }
}
