// LTD（F11）：低频削弱，不是删除。
export const HALF_LIFE_DAYS = 45

/** 按天衰减：45 天没被想起，权重砍一半。 */
export function decayFactor(lastSeen, now = Date.now(), halfLifeDays = HALF_LIFE_DAYS) {
  const days = Math.max(0, (now - Number(lastSeen || now)) / 86400000)
  return Math.pow(0.5, days / halfLifeDays)
}

export function applyLtd(weight, lastSeen, now = Date.now()) {
  return Math.max(0.05, weight * decayFactor(lastSeen, now))
}
