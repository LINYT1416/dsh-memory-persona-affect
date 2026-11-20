// 塑性：写得越多越难改，地板不归零。
// 人格器官共用这一条曲线——六块结构变起来的速度不一样，但规律一样。

export const QUENCH = { floor: 0.05, half: 300, shockTauMs: 72 * 3_600_000 }

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v)

export function plasticity({ n = 0, floor = QUENCH.floor, half = QUENCH.half, shock = 0 } = {}) {
  const base = floor + (1 - floor) * Math.pow(0.5, n / half)
  return clamp(base + shock, 0, 1)
}

export function touch(meta, amount = 0) {
  if (!meta) return meta
  meta.n = (meta.n || 0) + 1
  if (amount) addShock(meta, amount)
  return meta
}

export function addShock(meta, amount) {
  if (!meta) return meta
  meta.shock = clamp((meta.shock || 0) + amount, 0, 0.95)
  return meta
}

export function decayShock(meta, dtMs, tauMs = QUENCH.shockTauMs) {
  if (!meta || !meta.shock) return meta
  meta.shock *= Math.exp(-dtMs / Math.max(1, tauMs))
  if (meta.shock < 1e-4) meta.shock = 0
  return meta
}

export function blankMeta(neutral) {
  return { value: neutral, n: 0, shock: 0, source: 'prior' }
}
