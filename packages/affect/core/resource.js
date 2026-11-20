// 资源池：全局一个总池，四个子账（抑制 / 注意 / 共情 / 意志）。
// 规则见总表 C01、X05：只有这里能扣，别的模块只能申请。

export const POOLS = ['inhibit', 'attention', 'empathy', 'will']
export const PRIORITY = ['physiology', 'safety', 'social', 'expression']

export function createResources() {
  const state = {
    total: 1,
    sub: { inhibit: 1, attention: 1, empathy: 1, will: 1 },
    // 各自的恢复速率（每小时）
    recover: { inhibit: 0.35, attention: 0.5, empathy: 0.25, will: 0.4 },
    spentThisFrame: 0,
    log: [],
  }

  return {
    id: 'resource',
    read() {
      const avail = {}
      for (const k of POOLS) avail[k] = Math.min(state.total, state.sub[k])
      return { total: state.total, sub: { ...state.sub }, avail }
    },
    step(dtMs) {
      const h = dtMs / 3600_000
      state.total = Math.min(1, state.total + 0.5 * h)
      for (const k of POOLS) state.sub[k] = Math.min(1, state.sub[k] + state.recover[k] * h)
      state.spentThisFrame = 0
    },
    /** 申请（不是扣）：core 按优先级统一扣 */
    claim(pool, amount, why = '') {
      const a = Math.max(0, Math.min(amount, state.sub[pool] ?? 0, state.total))
      state.sub[pool] -= a
      state.total -= a
      state.spentThisFrame += a
      state.log.push({ pool, a, why })
      if (state.log.length > 50) state.log.shift()
      return a
    },
    snapshot: () => JSON.parse(JSON.stringify(state)),
    restore(o) { if (!o) return; Object.assign(state, JSON.parse(JSON.stringify(o))) },
  }
}
