// #P2-12 校验日志 / #P3-6 抑制可撤销 / #P3-9 perseveration 黑名单 / #P5-4 账本与清理
// 三条铁律：记了就带 why；压制带有效期；黑名单只进不出（除非手动清）。
import { readJsonl, appendJsonl, rewriteJsonl, tail } from './jsonl.js'
import { FILES, LIMITS } from './paths.js'

let verdictRows = null
let suppressedRows = null
let blacklist = null
let loading = null

/** 并发安全加载：缓存 promise 而不是结果，避免两个 await 各读一份互相覆盖。 */
export async function load() {
  if (verdictRows && suppressedRows) return { verdictRows, suppressedRows }
  if (!loading) {
    loading = (async () => {
      const v = await readJsonl(FILES.ledger)
      const s = await readJsonl(FILES.suppressed)
      verdictRows ||= v
      suppressedRows ||= s
      blacklist ||= new Set(s.filter((r) => r.kind === 'strategy').map((r) => r.key))
      return { verdictRows, suppressedRows }
    })()
  }
  await loading
  return { verdictRows, suppressedRows }
}

export async function verdict(row) {
  await load()
  const r = { at: Date.now(), ...row }
  verdictRows.push(r)
  await appendJsonl(FILES.ledger, r)
  return r
}

/**
 * 抑制记账（#P3-6）：带 ttl，过期就"可复用"。
 * 这是抑制能不能撤销的唯一依据。
 */
export async function suppress(rows = [], now = Date.now()) {
  await load()
  for (const s of rows) {
    const r = { kind: 'item', at: now, ttlMs: LIMITS.suppressedTtlMs, ...s }
    suppressedRows.push(r)
    await appendJsonl(FILES.suppressed, r)
  }
  return rows.length
}

/** 这条以前被压过吗？压过且没过期，就别再当新结果给。 */
export function wasSuppressed(id, now = Date.now()) {
  return suppressedRows?.some((r) => r.kind === 'item' && r.id === id && now - r.at < (r.ttlMs || LIMITS.suppressedTtlMs)) || false
}

/**
 * 失败策略黑名单（#P3-9 / R9）：换策略时必须绕开。
 * 只记"策略+意图"，不记具体 query（否则会过度泛化）。
 */
export async function blacklistStrategy(strategy, intent, why = '') {
  await load()
  const key = `${intent}:${strategy}`
  if (blacklist.has(key)) return { added: false, key }
  blacklist.add(key)
  const r = { kind: 'strategy', key, at: Date.now(), why }
  suppressedRows.push(r)
  await appendJsonl(FILES.suppressed, r)
  return { added: true, key }
}

export function strategyBlocked(strategy, intent) {
  return blacklist?.has(`${intent}:${strategy}`) || false
}

/** #P3-6 压制记录（带有效期，可复用）。 */
export function suppressed() {
  return suppressedRows || []
}

/** 清理（#P5-4）：保留最后 N 行，不无限涨。 */
export async function sweep(now = Date.now()) {
  await load()
  const before = verdictRows.length + suppressedRows.length
  verdictRows = tail(verdictRows, LIMITS.ledgerLines)
  suppressedRows = tail(suppressedRows, LIMITS.suppressedLines).filter((r) => {
    if (r.kind === 'strategy') return true // 黑名单不过期
    return now - r.at < (r.ttlMs || LIMITS.suppressedTtlMs) * 2
  })
  await rewriteJsonl(FILES.ledger, verdictRows)
  await rewriteJsonl(FILES.suppressed, suppressedRows)
  return { kept: verdictRows.length + suppressedRows.length, dropped: before - (verdictRows.length + suppressedRows.length) }
}

/** 只读投影（#P5-5）：给别的器官看"最近用了什么"。 */
export function projection(n = 20) {
  const rows = (verdictRows || []).slice(-n)
  return {
    recent: rows.map((r) => ({ at: r.at, query: r.query, hits: r.hits, conf: r.conf, flags: r.flags })),
    suppressed: (suppressedRows || []).slice(-n).map((r) => ({ id: r.id, reason: r.reason, at: r.at })),
    blacklist: [...(blacklist || [])],
  }
}

export function stats() {
  return {
    verdicts: verdictRows?.length || 0,
    suppressed: suppressedRows?.length || 0,
    blacklist: blacklist?.size || 0,
  }
}

export function reset() {
  loading = null
  verdictRows = null
  suppressedRows = null
  blacklist = null
}
