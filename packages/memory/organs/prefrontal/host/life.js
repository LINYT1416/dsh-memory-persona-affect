// #P5-10 崩溃兜底：检测 / 落盘 / 冷却
// 器官静默死是最糟的失败——日志一片绿，系统一片空。所以要有心跳和冷却。
const state = {
  started: Date.now(),
  lastBeat: 0,
  lastError: null,
  lastErrorAt: 0,
  crashes: 0,
  cooldownUntil: 0,
}

export function beat(now = Date.now()) {
  state.lastBeat = now
}

export function fail(error, now = Date.now(), { cooldownMs = 30 * 1000 } = {}) {
  state.crashes += 1
  state.lastError = String(error?.message || error || 'unknown')
  state.lastErrorAt = now
  state.cooldownUntil = now + cooldownMs
  return { crashes: state.crashes, cooldownUntil: state.cooldownUntil }
}

/**
 * 只记事、不计崩溃。
 * 区分很重要：探测失败/工具报错是"这一下调不动"，不是"插件崩了"。
 * 混在一起的结果是插件永久 cooling，什么都干不了（上一轮就是这么死的）。
 */
export function note(error, now = Date.now()) {
  state.lastError = String(error?.message || error || 'unknown')
  state.lastErrorAt = now
  return { lastError: state.lastError }
}

export function check(now = Date.now()) {
  const cooling = now < state.cooldownUntil
  const stale = state.lastBeat > 0 && now - state.lastBeat > 10 * 60 * 1000
  return {
    ok: !cooling && !stale,
    cooling,
    stale,
    crashes: state.crashes,
    lastError: state.lastError,
    uptimeMs: now - state.started,
  }
}

/** #P5-10 对外名字：健康检查（watch 是文档里的叫法）。 */
export const watch = check

/** 包装一个可能崩的操作：崩了降级返回，不炸整轮。 */
export function guard(fn, fallback = null) {
  try {
    const r = fn()
    beat()
    return r
  } catch (e) {
    fail(e)
    return fallback
  }
}

export async function guardAsync(fn, fallback = null) {
  try {
    const r = await fn()
    beat()
    return r
  } catch (e) {
    fail(e)
    return fallback
  }
}

export function snapshot() {
  return { ...state }
}

export function reset() {
  state.started = Date.now()
  state.lastBeat = 0
  state.lastError = null
  state.crashes = 0
  state.cooldownUntil = 0
}
