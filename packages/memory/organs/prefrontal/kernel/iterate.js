// #P1-7 迭代检索：第一轮不够就换策略，最多 2 轮（R3）。
// #P3-9 的黑名单在这里生效：换策略不许重复上一轮失败的那一招（R9）。
// 顺序很重要：**空结果要先放宽**，不是先收窄。
// 上一版把 narrow 放第一，结果"没找到"时第二轮收得更死，永远找不到。
const STRATEGIES = ['broaden', 'switch-mode', 'drop-time', 'narrow']

export function nextStrategy(tried = []) {
  for (const s of STRATEGIES) if (!tried.includes(s)) return s
  return null
}

/**
 * 第二轮计划。返回 null 表示"不许再扩"。
 * first：第一轮结果 { lowConfidence, hits, coverage, mode, intent }
 */
export function again(query, first = {}, ctx = {}) {
  if ((ctx.round || 1) >= 2) return null
  const tried = ctx.tried || []
  if (first.lowConfidence !== true && (first.hits?.length || 0) >= (ctx.k || 3)) return null

  const strategy = nextStrategy(tried)
  if (!strategy) return null

  const q = String(query ?? '')
  const next = { strategy, query: q, filters: { ...(first.filters || {}) }, mode: first.mode }
  const why = [`retry:${strategy}`]

  if (strategy === 'broaden') {
    next.filters = {}
    why.push('放宽过滤')
  } else if (strategy === 'narrow') {
    if (first.filters?.since) next.filters.since = Math.max(first.filters.since, ctx.now - 86400000)
    else next.filters.since = (ctx.now || Date.now()) - 86400000
    why.push('收窄到最近一天')
  } else if (strategy === 'switch-mode') {
    next.mode = first.mode === 'separate' ? 'complete' : 'separate'
    why.push(`换模式:${next.mode}`)
  } else if (strategy === 'drop-time') {
    delete next.filters.since
    delete next.filters.until
    why.push('去掉时间限制')
  }

  return { query: next.query, mode: next.mode, filters: next.filters, strategy, why, tried: [...tried, strategy] }
}
