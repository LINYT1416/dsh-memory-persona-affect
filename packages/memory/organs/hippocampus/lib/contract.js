// 跨器官契约：三个器官的桩 + 能力探测 + 事件 + 幂等 key。
// 对应功能总表：E1–E15、R15–R22 交接协议、C7 策略放桩后、C8 写不阻塞。

export const CONTRACT_VERSION = 1

/** 事件名（跨器官只发可序列化 JSON）。 */
export const EVENTS = {
  episodeCreated: 'memory/episode/created',
  episodeClosed: 'memory/episode/closed',
  episodeConsolidated: 'memory/episode/consolidated',
  recallRequested: 'memory/recall/requested',
  recallAnswered: 'memory/recall/answered',
  episodeArchived: 'memory/episode/archived',
}

/** R17：幂等 key。 */
export function dedupeKey(episodeId, version) {
  return `${episodeId}@${version ?? 1}`
}

/** 交接物统一带版本（R21）。 */
export function envelope(kind, payload) {
  return { v: CONTRACT_VERSION, kind, at: Date.now(), payload }
}

/**
 * 探测三个器官：拿到就挂，拿不到就用桩。
 * 桩的返回值就是“单器官能跑”的物理保证。
 */
export function makeAdapters(ctx) {
  const get = (name) => {
    try {
      return ctx?.get?.(name) ?? null
    } catch {
      return null
    }
  }

  // 没接就是 null：所有调用点都走 optional chaining，null 自然落到规则实现。
  // （不能给一个带同名方法的桩对象——那会被误判成“已接入”，规则永远不跑。）
  const cortex = get('memory.cortex')
  const amygdala = get('memory.amygdala')
  const prefrontal = get('memory.prefrontal')

  const capabilities = {
    cortex: Boolean(cortex),
    amygdala: Boolean(amygdala),
    prefrontal: Boolean(prefrontal),
    version: CONTRACT_VERSION,
  }

  return { cortex, amygdala, prefrontal, capabilities }
}

/**
 * 写路径上的跨器官调用：只 push 不 await 结果（R15），
 * 超时吃默认（R16），并行取（R18）。
 */
export async function fanout(tasks, { timeoutMs = 50 } = {}) {
  return Promise.all(tasks.map((fn) => raceTimeout(fn, timeoutMs)))
}

export async function raceTimeout(fn, timeoutMs = 50) {
  try {
    const p = Promise.resolve().then(fn)
    const t = new Promise((resolve) => setTimeout(() => resolve(null), timeoutMs))
    return await Promise.race([p, t])
  } catch {
    return null
  }
}

/**
 * 事件去抖（R20）：episode-created 每 200ms 或攒 10 条发一批。
 */
export function makeEventBuffer(emit, { windowMs = 200, max = 10 } = {}) {
  let buf = []
  let timer = null
  const flush = () => {
    if (timer) { clearTimeout(timer); timer = null }
    if (!buf.length) return
    const batch = buf
    buf = []
    try { emit?.(batch) } catch { /* 发不出去不影响写入 */ }
  }
  return {
    push(event) {
      buf.push(event)
      if (buf.length >= max) flush()
      else if (!timer) timer = setTimeout(flush, windowMs)
      if (timer?.unref) timer.unref()
    },
    flush,
  }
}

/**
 * 防循环依赖（R19）：读路径回调最多 1 层，且带重入标记。
 */
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
  }
}
