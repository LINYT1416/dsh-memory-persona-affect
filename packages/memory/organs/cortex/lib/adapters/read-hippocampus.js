// 上游 · 海马体（F35）：取事件索引、原始表征、痕迹、安静信号。
// 优先走 API；没有只读 API 时直读它的数据文件兜底；超时吃默认（R16）。
// 海马体的真实返回形状和文件形状不一样（at/start、quiet 包对象、traces 是统计包），
// 这一层负责归一化，上层只认 start/end/boolean/array。
import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

const HIPPO_DIR = process.env.HIPPOCAMPUS_DIR || join(homedir(), '.dsh', 'hippocampus')

function readJsonlFile(file) {
  return readFile(file, 'utf8')
    .then((text) => text.split('\n').filter((l) => l.trim()).map((l) => {
      try { return JSON.parse(l) } catch { return null }
    }).filter(Boolean))
    .catch(() => [])
}

export async function withTimeout(promise, ms, fallback) {
  let timer = null
  const timeout = new Promise((resolve) => { timer = setTimeout(() => resolve(fallback), ms) })
  try {
    return await Promise.race([promise, timeout])
  } catch {
    return fallback
  } finally {
    if (timer) clearTimeout(timer)
  }
}

/** 把海马体 episode 归一成皮层认的字段。 */
export function normalizeEpisode(e = {}) {
  const at = Number(e.start ?? e.at ?? e.end ?? 0)
  return {
    ...e,
    id: e.id || e.episodeId,
    session: e.session || e.anchor?.sessionId || '',
    start: at,
    end: Number(e.end ?? at),
    text: e.text || e.summary || '',
    summary: e.summary || e.text || '',
    entities: Array.isArray(e.entities) ? e.entities : [],
    rawIds: Array.isArray(e.rawIds) ? e.rawIds : [],
  }
}

export function wrapHippocampus(api) {
  const has = (name) => api && typeof api[name] === 'function'
  return {
    available: Boolean(api),
    get mode() { return has('episodes') ? 'api' : 'file' },
    get vectorReady() {
      try { return Boolean(api?.vectorReady) } catch { return false }
    },
    async episodes({ since = 0, limit = 200, state = '', session = '' } = {}) {
      if (has('episodes')) {
        try {
          const out = await withTimeout(Promise.resolve(api.episodes({ since, limit, state, session })), 200, null)
          if (Array.isArray(out)) return out.map(normalizeEpisode)
        } catch { /* 落到文件 */ }
      }
      const rows = await readJsonlFile(join(HIPPO_DIR, 'episodes.jsonl'))
      return rows
        .filter((e) => (!since || Number(e.start || 0) >= since)
          && (!state || e.state === state)
          && (!session || (e.anchor?.sessionId || e.session) === session))
        .sort((a, b) => Number(a.start || 0) - Number(b.start || 0))
        .slice(-limit)
        .map(normalizeEpisode)
    },
    async raw({ episodeId, days = 3650, limit = 5000 } = {}) {
      if (has('raw')) {
        try {
          const out = await withTimeout(Promise.resolve(api.raw({ days, limit })), 200, null)
          if (Array.isArray(out)) {
            if (!episodeId) return out
            // 有 episode 接口就拿 rawIds 精确过滤；没有就按 episodeId 字段过滤
            if (has('episode')) {
              const ep = await withTimeout(Promise.resolve(api.episode(episodeId)), 200, null)
              const ids = new Set(ep?.rawIds || [])
              if (ids.size) return out.filter((r) => ids.has(r.id))
            }
            return out.filter((r) => r.episodeId === episodeId)
          }
        } catch { /* 落到文件 */ }
      }
      return []
    },
    async traces({ since = 0, limit = 500 } = {}) {
      if (has('traces')) {
        try {
          const out = await withTimeout(Promise.resolve(api.traces()), 200, null)
          if (Array.isArray(out)) return out
          // 海马体的 traces() 是统计包：{total, at, recent}
          if (out && Array.isArray(out.recent)) {
            return out.recent.filter((t) => Number(t.at || 0) >= since).slice(-limit)
          }
        } catch { /* 落到文件 */ }
      }
      const rows = await readJsonlFile(join(HIPPO_DIR, 'traces.jsonl'))
      return rows.filter((t) => Number(t.at || 0) >= since).slice(-limit)
    },
    async quiet(minutes = 30) {
      if (has('quiet')) {
        try {
          const out = await withTimeout(Promise.resolve(api.quiet({ minutes })), 50, null)
          if (typeof out === 'boolean') return out
          if (out && typeof out.quiet === 'boolean') return out.quiet
        } catch { /* 落到规则 */ }
      }
      const eps = await this.episodes({ limit: 1 })
      if (!eps.length) return true
      return Date.now() - Number(eps[eps.length - 1].end || 0) >= minutes * 60000
    },
    on(name, handler) {
      if (has('on')) return api.on(name, handler)
      return () => {}
    },
  }
}
