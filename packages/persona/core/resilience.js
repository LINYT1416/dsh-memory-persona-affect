// T07 复原力：跌下去以后能爬回来多少，取决于有没有人接着。
// 判据：不是"心情会自己好"，而是"有人接着就回得快"——所以支持度必须是输入。

const BASELINE = 0.5

/**
 * 支持的强度：关系越近、越有人管，恢复越快。
 * @param {{intimacy?:number, apologies?:number}} rel
 * @returns {{ multiplier:number, because:string }}
 */
export function resilience(rel = {}) {
  const n = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0)
  const intimacy = n(rel.intimacy)
  const apologies = n(rel.apologies)
  // 0.6 倍（没人管）到 1.6 倍（很熟且道过歉）
  const multiplier = Math.min(1.6, 0.6 + intimacy * 0.8 + Math.min(0.2, apologies * 0.05))
  return { multiplier: Number(multiplier.toFixed(2)), because: intimacy >= 0.5 ? 'supported' : 'alone' }
}

/**
 * 从低谷往回爬。
 * @param {number} value 当前值（0~1，越高越好）
 * @param {number} hours 过了多少小时
 * @param {number} multiplier 复原力倍率
 */
export function recover(value, hours, multiplier = 1) {
  const v = Number.isFinite(Number(value)) ? Number(value) : BASELINE
  const h = Math.max(0, Number(hours) || 0)
  const m = Math.max(0.1, Number(multiplier) || 1)
  const gap = BASELINE - v
  if (gap === 0) return v
  // 每 24 小时最多回差距的 35% × 倍率
  const ratio = Math.min(1, (h / 24) * 0.35 * m)
  return Number((v + gap * ratio).toFixed(3))
}
