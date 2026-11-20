// 遗忘：可及性衰减、时间梯度、主动遗忘、分层失效。
// 对应功能总表：L5-1 遗忘、L5-2 时间梯度、L5-5 主动遗忘、L5-6 分层失效、R2 权重顺序、R7 退场vs遗忘。

export const DAY = 24 * 60 * 60 * 1000

/**
 * 可及性衰减（L5-1）：半衰期由 salience 调制。
 * 基准值用 baseAccessibility（写入时定下），不能用上一次算出来的 accessibility——
 * 否则每次 sweep 都在“已经衰减过的值”上再衰减一次，衰减会指数加速。
 */
export function decayedAccessibility(ep, now = Date.now()) {
  const base = Number(ep.baseAccessibility ?? ep.salience ?? 0.3)
  const halfLifeDays = 2 + 6 * Number(ep.salience ?? 0.3) // 重要 8 天，普通 2 天
  const ageDays = Math.max(0, (now - Number(ep.end || ep.start || now)) / DAY)
  return Math.max(0, base * Math.pow(0.5, ageDays / halfLifeDays))
}

/** R2：先衰减 → 乘重放加成（上限 1.5）→ 乘主动遗忘系数。 */
export function effectiveScore(ep, { now = Date.now(), replayBoost = 1, activeForget = 1 } = {}) {
  const decayed = decayedAccessibility(ep, now)
  const boost = Math.min(1.5, Math.max(1, replayBoost))
  return Math.max(0, Math.min(1, decayed * boost * activeForget))
}

/** 时间梯度（L5-2）：可及性上新条目略高；依赖度上旧条目更稳。 */
export function timeGradient(ep, now = Date.now()) {
  const ageDays = Math.max(0, (now - Number(ep.start || now)) / DAY)
  return {
    accessibilityBias: Math.max(0.7, 1 - ageDays / 365), // 新的略高
    dependency: Math.min(1, 0.2 + ageDays / 60),          // 旧的更不依赖（更可能已转移）
  }
}

/** 主动遗忘（L5-5）：新记忆写入时，把同实体的旧条目可及性打一下。 */
export function activeForgetFactor(sharedEntityCount) {
  // 实体重合越多，旧条目被打得越狠，但不低于 0.6（R2 系数下限）
  return Math.max(0.6, 1 - 0.08 * Math.max(0, sharedEntityCount))
}

/** 是否该归档（不删，只标）。 */
export function shouldArchive(score) {
  return score < 0.04
}

/** 分层失效（L5-6）：每层独立开关，关掉只降级。 */
export const LAYERS = ['encode', 'index', 'recall', 'consolidate', 'forget']

export function makeLayerSwitch() {
  const off = new Set()
  return {
    off: (name) => off.add(name),
    on: (name) => off.delete(name),
    isOff: (name) => off.has(name),
    list: () => LAYERS.map((name) => ({ name, on: !off.has(name) })),
  }
}

/** 扫描一遍：算可及性，过线的标 archived（L5-1）。不删原文。 */
export async function sweepOnce(store, now = Date.now()) {
  let swept = 0
  for (const ep of store.allEpisodes()) {
    if (ep.state === 'archived') continue
    const score = effectiveScore(ep, { now, replayBoost: ep.replayBoost || 1 })
    ep.accessibility = Number(score.toFixed(4))
    if (score < 0.04) {
      ep.state = 'archived'
      ep.archivedAt = now
      swept += 1
    }
    store.touch(ep)
  }
  return { swept }
}
