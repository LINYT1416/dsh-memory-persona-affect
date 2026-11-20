// #P2-5 冲突落队（不覆盖原条目）/ #P5-14 冲突队列处置
// 队列必须有"派给谁、等多久、过期怎么办"，否则会一直堆。
import { readJsonl, appendJsonl, rewriteJsonl, tail } from './jsonl.js'
import { FILES, LIMITS } from './paths.js'

let rows = null
let loading = null
const DISPATCH_TTL = 7 * 86400000

export async function load() {
  if (!rows) {
    if (!loading) {
      loading = readJsonl(FILES.conflicts).then((r) => {
        rows ||= r
        return rows
      })
    }
    await loading
  }
  return rows
}

/**
 * 入队。同 (aId,bId,field) 只留一条，避免每轮重复写。
 * 注意：这里**只标记**，绝不改原条目（文档 §3.5）。
 */
export async function enqueue(pairs = [], now = Date.now()) {
  await load()
  const out = []
  for (const p of pairs) {
    const key = `${p.aId}|${p.bId}|${p.field}`
    if (rows.some((r) => r.key === key && r.state !== 'expired')) continue
    const row = {
      key,
      ...p,
      at: now,
      state: 'open',
      owner: 'cortex', // 语义裁决归皮层（§2 事实层）
      dueAt: now + DISPATCH_TTL,
      opinion: null,
    }
    rows.push(row)
    out.push(row)
    await appendJsonl(FILES.conflicts, row)
  }
  return out
}

/**
 * 处置（#P5-14）：派给谁 + 到期怎么办。
 * 皮层不在：到期后标 expired，**保留记录**，不许当成"已解决"。
 */
export async function dispatch(now = Date.now(), { cortex = false } = {}) {
  await load()
  let expired = 0
  let waiting = 0
  for (const r of rows) {
    if (r.state !== 'open') continue
    if (!cortex) {
      if (now > r.dueAt) {
        r.state = 'expired'
        r.opinion = 'no-adjudicator'
        expired += 1
      } else waiting += 1
    }
  }
  if (expired) await rewriteJsonl(FILES.conflicts, tail(rows, LIMITS.conflictLines))
  return { open: rows.filter((r) => r.state === 'open').length, expired, waiting }
}

/** 皮层给了裁决，回填（不是覆盖原条目，是给队列一个结论）。 */
export async function resolve(key, verdict, now = Date.now()) {
  await load()
  const row = rows.find((r) => r.key === key)
  if (!row) return null
  row.state = 'resolved'
  row.opinion = verdict
  row.resolvedAt = now
  await rewriteJsonl(FILES.conflicts, tail(rows, LIMITS.conflictLines))
  return row
}

export function open(n = 20) {
  return (rows || []).filter((r) => r.state === 'open').slice(-n)
}

export function stats() {
  const all = rows || []
  return {
    total: all.length,
    open: all.filter((r) => r.state === 'open').length,
    expired: all.filter((r) => r.state === 'expired').length,
    resolved: all.filter((r) => r.state === 'resolved').length,
  }
}

export function reset() {
  loading = null
  rows = null
}
