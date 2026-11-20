// 跨器官契约：版本、信封、幂等 key、能力等级、防重入、超时。
// 对应功能总表：A8-1 能力等级、A8-5 版本迁移、C7 桩后、P1–P8 交接协议。

export const V = 1

/** 跨器官事件名。 */
export const EVENTS = {
  scored: 'memory/amygdala/scored',
  captured: 'memory/amygdala/captured',
  review: 'memory/amygdala/review',
  conflict: 'memory/amygdala/conflict',
  gate: 'memory/amygdala/gate',
}

/** 能力等级：L0 没有、L1 有字符串、L2 有结构化。 */
export const LEVEL = { NONE: 0, STRING: 1, STRUCT: 2 }

export function capability(level) {
  const n = Number(level)
  if (!Number.isFinite(n) || n <= 0) return 'L0'
  return n >= 2 ? 'L2' : 'L1'
}

/** 交接物统一带版本（P4）。 */
export function envelope(kind, payload) {
  return { v: V, kind, at: Date.now(), payload }
}

/** 幂等 key（P3）。 */
export function dedupeKey(id, version) {
  return `${id}@${version ?? 1}`
}

/**
 * 读旧记录时迁移。加字段不升版本；改语义升版本。
 * 现在只有 v1，留好入口。
 */
export function migrate(row) {
  if (!row || typeof row !== 'object') return null
  const v = Number(row.v ?? 1)
  if (v === V) return row
  if (v < V) return { ...row, v: V, migratedFrom: v }
  // 比当前新：不认识就不猜（P4）
  return { ...row, v: V, unknownVersion: v }
}

/** 防重入：读路径回调最多一层（P7）。 */
export function makeReentryGuard(depth = 1) {
  let level = 0
  return {
    enter() {
      if (level >= depth) return false
      level += 1
      return true
    },
    leave() {
      level = Math.max(0, level - 1)
    },
    get depth() {
      return level
    },
  }
}

/** 超时吃默认，不重试（P2）。缺信息时调用方应向 0.5 收缩。 */
export async function raceTimeout(fn, timeoutMs = 50, fallback = null) {
  try {
    const p = Promise.resolve().then(fn)
    const t = new Promise((resolve) => setTimeout(() => resolve(fallback), timeoutMs))
    return await Promise.race([p, t])
  } catch {
    return fallback
  }
}

/** 事件去抖：200ms 或 10 条一批（P6）。 */
export function makeEventBuffer(emit, { windowMs = 200, max = 10 } = {}) {
  let buf = []
  let timer = null
  const flush = () => {
    if (timer) {
      clearTimeout(timer)
      timer = null
    }
    if (!buf.length) return
    const batch = buf
    buf = []
    try {
      emit?.(batch)
    } catch { /* 发不出去不影响主流程 */ }
  }
  return {
    push(event) {
      buf.push(event)
      if (buf.length >= max) flush()
      else if (!timer) {
        timer = setTimeout(flush, windowMs)
        timer.unref?.()
      }
    },
    flush,
  }
}
