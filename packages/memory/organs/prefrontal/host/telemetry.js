// #P5-3 telemetry + 跨带缓存（T3 算完的结果，T0 直接查）
// 缓存命中率低的时候，正确做法不是加缓存，是把这条功能从 T0 移到 T1。
import { readJson, writeJson } from '../store/jsonl.js'
import { FILES } from '../store/paths.js'

const counters = {
  plan: 0,
  judge: 0,
  gate: 0,
  retrieve: 0,
  kept: 0,
  suppressed: 0,
  cacheHit: 0,
  cacheMiss: 0,
  shadow: 0,
  warn: 0,
  errors: 0,
}

const cache = new Map()

export function inc(name, n = 1) {
  if (name in counters) counters[name] += n
}

export function snapshot() {
  const c = { ...counters }
  const total = c.cacheHit + c.cacheMiss
  return {
    ...c,
    cacheRate: total ? Number((c.cacheHit / total).toFixed(3)) : null,
    keepRate: c.judge ? Number((c.kept / c.judge).toFixed(3)) : null,
  }
}

export async function flush() {
  await writeJson(FILES.telemetry, { at: Date.now(), ...snapshot() })
  return snapshot()
}

export async function load() {
  const old = await readJson(FILES.telemetry, null)
  if (old) for (const k of Object.keys(counters)) if (Number.isFinite(old[k])) counters[k] = old[k]
  return snapshot()
}

/** 缓存键：意图 + 实体集 + 时间窗 + 候选集指纹。键错了会一直 miss。 */
export function keyOf(intent, filters = {}, ids = []) {
  const f = [filters.since || 0, filters.until || 0, filters.type || ''].join('-')
  const id = [...ids].sort().join(',').slice(0, 120)
  return `${intent}|${f}|${id}`
}

export function set(key, value, ttlMs = 10 * 60 * 1000) {
  cache.set(key, { value, until: Date.now() + ttlMs })
}

export function get(key) {
  const hit = cache.get(key)
  if (!hit) { inc('cacheMiss'); return null }
  if (Date.now() > hit.until) { cache.delete(key); inc('cacheMiss'); return null }
  inc('cacheHit')
  return hit.value
}

export function clear() {
  cache.clear()
}

export function size() {
  return cache.size
}
