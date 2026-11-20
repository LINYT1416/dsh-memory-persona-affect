// 五个对外口：只读别人，只写自己（C4）。
// 对应功能总表：E1–E16、A8-1 能力等级、P2 缺信息向 0.5 收缩。
//
// 原则：没接就是 null / 空实现，所有调用点空值降级，不抛错。
// **全部惰性求值**：别人的器官可能比我后加载（这是最容易踩的坑）。

import { join } from 'node:path'
import { homedir } from 'node:os'
import { readJsonl } from './store.js'

export const HIPPO_DIR = process.env.HIPPOCAMPUS_DIR || join(homedir(), '.dsh', 'hippocampus')

/** 探测 ctx 里的服务，拿不到就 null。 */
function get(ctx, name) {
  try {
    return ctx?.get?.(name) ?? null
  } catch {
    return null
  }
}

export function makePorts(ctx) {
  // 每次调用时才查，不在 apply 时快照
  const hippo = () => get(ctx, 'memory.hippocampus')
  const moodOf = () => get(ctx, 'memory.mood') || get(ctx, 'mood')
  const frontal = () => get(ctx, 'memory.prefrontal')
  const cort = () => get(ctx, 'memory.cortex')

  // ── 取数：读海马索引（只读，不复制正文） ──────────────────
  const source = {
    /** 列最近的 episode 骨架。 */
    async list({ since = 0, limit = 200 } = {}) {
      const provider = hippo()
      if (provider?.recall) {
        try {
          const out = await provider.recall('', { k: limit })
          const rows = (out?.hits || []).filter((h) => Number(h.at) >= since)
          return { rows, via: 'provider' }
        } catch { /* 落回文件 */ }
      }
      const rows = await readJsonl(join(HIPPO_DIR, 'index.jsonl'), { limit })
      return {
        rows: rows
          .filter((r) => Number(r.at) >= since)
          .map((r) => ({
            episodeId: r.episodeId,
            at: r.at,
            summary: r.summary,
            entities: r.entities || [],
            place: r.place || '',
            type: r.type || '',
            session: r.session || '',
            source: { channel: 'dsh', speaker: 'user' },
          })),
        via: 'file',
      }
    },

    /** 按 id 读原文。只在需要精确判断时用，不缓存。 */
    async readRaw(rawId) {
      if (!rawId) return null
      const rows = await readJsonl(join(HIPPO_DIR, 'raw', `${rawId}.jsonl`))
      return rows[0] || null
    },
  }

  // ── 回传：优先写入口（E5）+ 事件 ──────────────────────────
  const sink = {
    /** 给皮层的优先写：没接就空转。 */
    async prioritize(item) {
      const c = cort()
      if (!c?.prioritize) return { sent: false, reason: 'no-cortex' }
      try {
        await c.prioritize(item)
        return { sent: true, via: 'cortex' }
      } catch (error) {
        return { sent: false, reason: String(error?.message || error) }
      }
    },
    /** 给前额叶的复核请求（E11）。 */
    async requestReview(item) {
      const p = frontal()
      if (!p?.review) return { sent: false, reason: 'no-prefrontal' }
      try {
        await p.review(item)
        return { sent: true, via: 'prefrontal' }
      } catch (error) {
        return { sent: false, reason: String(error?.message || error) }
      }
    },
  }

  // ── 心情（E7）：唯一硬依赖，拿不到就 null ──────────────────
  const mood = {
    current() {
      const m0 = moodOf()
      if (!m0) return null
      try {
        const m = m0.current?.() ?? m0.read?.() ?? m0
        if (!m) return null
        const valence = Number(m.valence ?? m.value ?? 0)
        const arousal = Number(m.arousal ?? 0)
        return {
          valence: Math.max(-1, Math.min(1, valence || 0)),
          arousal: Math.max(-1, Math.min(1, arousal || 0)),
          source: 'provider',
        }
      } catch {
        return null
      }
    },
  }

  // ── 消退裁决（E6）：前额叶说了算，没有就我自己算 ──────────
  const judge = {
    verdict(episodeId, fallback = null) {
      const p = frontal()
      if (!p?.shouldGate) return fallback
      try {
        const v = p.shouldGate(episodeId)
        return v === undefined ? fallback : v
      } catch {
        return fallback
      }
    },
  }

  // ── 目标（E17）：前额叶的 dlPFC 是"保持目标"的中心（文档 3.1）
  // 杏仁核的 goal 因子没有来源，就只能永远为 0
  const goals = {
    current() {
      const p = frontal()
      if (!p) return []
      try {
        const g = p.goals?.() ?? p.currentGoals?.() ?? p.taskState?.goals ?? []
        return Array.isArray(g) ? g.filter((x) => typeof x === 'string' && x) : []
      } catch {
        return []
      }
    },
  }

  // ── 标定参照（E10）：皮层有全局分布就用它的 ──────────────
  const calibrator = {
    percentile(score, samples = []) {
      const c = cort()
      if (c?.percentile) {
        try {
          const p = c.percentile(score)
          if (Number.isFinite(Number(p))) return { value: Number(p), via: 'cortex' }
        } catch { /* 落回本地 */ }
      }
      if (!samples.length) return { value: 0.5, via: 'default' }
      let le = 0
      for (const s of samples) if (Number(s) <= score) le += 1
      return { value: le / samples.length, via: 'local' }
    },
  }

  // 注意：这是 getter，每次读都重新判定，所以晚加载的器官也能被看见
  const capabilities = {
    get source() { return hippo() ? 'provider' : 'file' },
    get sink() { return cort() ? 'cortex' : 'none' },
    get mood() { return moodOf() ? 'live' : 'none' },
    get judge() { return frontal() ? 'prefrontal' : 'self' },
    get calibrator() { return cort() ? 'cortex' : 'local' },
    get goals() { return frontal() ? 'prefrontal' : 'none' },
    get version() { return 1 },
    toJSON() {
      return {
        source: this.source,
        sink: this.sink,
        mood: this.mood,
        judge: this.judge,
        calibrator: this.calibrator,
        goals: this.goals,
        version: this.version,
      }
    },
  }

  return { source, sink, mood, judge, goals, calibrator, capabilities }
}
