// 审计：只记决策，不记原文（C9 / C12）。
// 对应功能总表：A7-2 审计、A7-3 压缩、A7-6 健康检查。

import { appendJsonl, readJsonl, rewriteJsonl, FILES, DATA_DIR, sizeOf, exists } from './store.js'

export const DAY = 24 * 60 * 60 * 1000

export function makeAudit({ max = 800 } = {}) {
  const ring = []
  const pending = []

  /** 决策日志：谁、为什么、改了多少。绝不带原文。 */
  function log(kind, payload = {}) {
    const row = { at: Date.now(), kind, ...payload }
    ring.push(row)
    if (ring.length > max) ring.shift()
    const p = appendJsonl(FILES.audit, row).catch(() => {})
    pending.push(p)
    if (pending.length > 200) pending.splice(0, 100)
    return row
  }

  async function flush() {
    await Promise.all(pending.splice(0))
  }

  function recent(n = 20) {
    return ring.slice(-n)
  }

  return { log, flush, recent, size: () => ring.length }
}

/**
 * 压缩：90 天前的审计压成「每天每 kind 多少条」。
 * 只压审计，不压分数样本（标定要用）。
 */
export async function compactAudit({ keepDays = 90, now = Date.now() } = {}) {
  const rows = await readJsonl(FILES.audit)
  if (!rows.length) return { before: 0, after: 0, compacted: 0 }
  const cut = now - keepDays * DAY
  const keep = []
  const old = []
  for (const row of rows) {
    if (Number(row.at) >= cut) keep.push(row)
    else old.push(row)
  }
  if (!old.length) return { before: rows.length, after: rows.length, compacted: 0 }

  const buckets = new Map()
  for (const row of old) {
    const day = new Date(Number(row.at)).toISOString().slice(0, 10)
    const key = `${day}|${row.kind || 'unknown'}`
    buckets.set(key, (buckets.get(key) || 0) + 1)
  }
  const compacted = [...buckets.entries()].map(([key, count]) => {
    const [day, kind] = key.split('|')
    return { v: 1, at: new Date(`${day}T00:00:00Z`).getTime(), kind: 'daily', day, of: kind, count }
  })

  await rewriteJsonl(FILES.audit, [...compacted, ...keep])
  return { before: rows.length, after: compacted.length + keep.length, compacted: compacted.length }
}

/** 健康检查：目录、文件、样本、deep 占比。 */
export async function health() {
  const dirOk = exists(DATA_DIR)
  const sizes = {}
  for (const [name, file] of Object.entries(FILES)) {
    sizes[name] = await sizeOf(file)
  }
  return { dir: DATA_DIR, dirOk, sizes }
}
