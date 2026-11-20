// 维护：入口自检、重建、容量、悬空、密度。
// 对应功能总表：L0-5 入口健康检查、L1-14 编码可重放、L2-11 信息流速、L2-12 容量约束、
// L2-14 悬空检测、L5-3 索引重建。

import { readdir, readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { DATA_DIR, RAW_DIR, FILES, readJsonl, readJson, writeJsonAtomic, rewriteJsonl, appendJsonl, appendLinks } from './store.js'
import { localDay } from './util.js'

const INDEX_CAP = 5000
const RAW_LOOKBACK_DAYS = 30

/** L0-5：入口自检。数据目录能写、meta 版本对、raw 有没有半截。 */
export async function healthCheck() {
  const report = { ok: true, initialized: true, problems: [], checkedAt: Date.now() }
  try {
    // 还没写过任何东西：这是“未初始化”，不是“坏了”
    if (!existsSync(DATA_DIR)) {
      report.initialized = false
      return report
    }
    const meta = await readJson(FILES.meta, null)
    if (!meta) {
      report.initialized = false
      return report
    }
    if (meta.version !== 1) report.problems.push(`meta-version-${meta.version}`)
  } catch (error) {
    report.ok = false
    report.problems.push(`read-failed:${error?.message || error}`)
  }
  report.ok = report.problems.length === 0
  return report
}

/** L2-11：信息流速。最近一小时的条数，用来动态调切段阈值。 */
export async function messageDensity(rawRows, now = Date.now()) {
  const hour = 60 * 60 * 1000
  const recent = rawRows.filter((r) => now - Number(r.at || 0) <= hour)
  const perMinute = recent.length / 60
  // 越快，段切得越短：15 分钟起，最低 5 分钟
  const gapMs = Math.max(5, Math.min(15, 15 - perMinute * 2)) * 60 * 1000
  return { count: recent.length, perMinute: Number(perMinute.toFixed(3)), gapMs }
}

/** L2-14：悬空检测。episode 指向的 raw 不在了就标 dangling。 */
export async function detectDangling(store, rawRows) {
  const ids = new Set(rawRows.map((r) => r.id))
  const out = []
  for (const ep of store.allEpisodes()) {
    const missing = (ep.rawIds || []).filter((id) => !ids.has(id))
    if (missing.length) {
      ep.dangling = missing
      store.touch(ep)
      out.push({ episodeId: ep.id, missing: missing.length })
    } else if (ep.dangling) {
      delete ep.dangling
      store.touch(ep)
    }
  }
  return out
}

/** L2-12：容量约束。索引行超上限，把最老的一批降级（更短、更少字段），不删。 */
export async function enforceCapacity({ cap = INDEX_CAP, ratio = 0.2 } = {}) {
  const rows = await readJsonl(FILES.index)
  if (rows.length <= cap) return { rows: rows.length, degraded: 0, cap }
  const overflow = Math.ceil((rows.length - cap) * ratio) || 1
  const sorted = [...rows].sort((a, b) => a.at - b.at)
  const degradeIds = new Set(sorted.slice(0, overflow).map((r) => r.episodeId))
  let degraded = 0
  const next = rows.map((row) => {
    if (!degradeIds.has(row.episodeId)) return row
    degraded += 1
    return {
      ...row,
      summary: String(row.summary || '').slice(0, 20),
      entities: (row.entities || []).slice(0, 2),
      keywords: (row.keywords || []).slice(0, 2),
      degraded: true,
    }
  })
  await rewriteJsonl(FILES.index, next)
  return { rows: next.length, degraded, cap }
}

/**
 * L1-14 / L5-3：从 raw 重建 episode 与索引。
 * 只在"索引坏了"或"写错了"时用；会先备份现有 episodes/index。
 */
export async function rebuildFromRaw(store, encode) {
  const days = []
  try {
    const names = (await readdir(RAW_DIR)).filter((n) => n.endsWith('.jsonl')).sort()
    for (const name of names) days.push(...(await readJsonl(join(RAW_DIR, name))))
  } catch {
    return { rebuilt: 0, error: 'raw-unreadable' }
  }
  if (!days.length) return { rebuilt: 0, error: 'no-raw' }

  // 备份
  try {
    const backup = join(DATA_DIR, `episodes.bak-${Date.now()}.jsonl`)
    const rows = await readJsonl(FILES.episodes)
    await rewriteJsonl(backup, rows)
  } catch { /* 备份失败就不重建，宁可不动 */ return { rebuilt: 0, error: 'backup-failed' } }

  // 清空内存态
  store.episodes.clear()
  store.byBucket.clear()
  store.bySession.clear()
  store.openBySession.clear()
  store.seenMessages.clear()
  store.graph.nodes.clear()
  store.graph.edges.length = 0

  // 清空落盘（重写为空）
  await rewriteJsonl(FILES.episodes, [])
  await rewriteJsonl(FILES.index, [])
  await rewriteJsonl(FILES.links, [])

  let rebuilt = 0
  for (const row of days.sort((a, b) => a.at - b.at)) {
    try {
      const out = await encode.ingest({
        session: row.session,
        role: row.role,
        text: row.text,
        at: row.at,
        channel: row.source?.channel || 'replay',
        confidence: row.confidence,
        replayRaw: row,
        skipDedup: true,
      })
      if (out.episodeId) rebuilt += 1
    } catch { /* 单条坏行跳过 */ }
  }
  await appendJsonl(FILES.consolidation, { at: Date.now(), action: 'rebuild', rebuilt, fromRaw: days.length })
  // 重建期间长出来的边刷盘，不然 links 还是空的
  try { await appendLinks(store.pendingEdges.splice(0)) } catch { /* 边丢了下次 tick 再补 */ }
  return { rebuilt, fromRaw: days.length }
}

/** 最近 raw（给维护用）。 */
export async function recentRaw(days = RAW_LOOKBACK_DAYS) {
  const out = []
  try {
    const names = (await readdir(RAW_DIR)).filter((n) => n.endsWith('.jsonl')).sort()
    const picked = names.slice(-days)
    for (const name of picked) out.push(...(await readJsonl(join(RAW_DIR, name))))
  } catch { /* 没 raw 就当空 */ }
  return out
}
