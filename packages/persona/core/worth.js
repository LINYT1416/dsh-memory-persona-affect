// S02 自尊（完整版）：不是一次读数，是会累积、会回落的东西。
// 依据：被夸会飘但嘴硬；被否定会掉；时间长了往中间回。

const BASELINE = 0.5
const PRAISE = 0.06
const CRITICISM = 0.08      // 负性偏差：一句骂比一句夸更管用
const DECAY_PER_HOUR = 0.004 // 每小时往基线回一点（一天约回 0.1，不会一夜复原）
const FLOOR = 0.05
const CEIL = 0.95

const clamp = (v) => Math.min(CEIL, Math.max(FLOOR, v))
const num = (v, fallback) => (Number.isFinite(Number(v)) ? Number(v) : fallback)

export function createWorth(state = {}) {
  // 脏数据在入口就洗掉：'x' / NaN 不许进到内部状态里
  const s = {
    value: clamp(num(state.value, BASELINE)),
    at: num(state.at, Date.now()),
    praise: Math.max(0, num(state.praise, 0)),
    criticism: Math.max(0, num(state.criticism, 0)),
  }

  // 时间会把它拉回基线：不会一直飘，也不会一直塌
  function settle(now = Date.now()) {
    const hours = Math.max(0, (now - (Number(s.at) || now)) / (60 * 60 * 1000))
    if (hours <= 0) return
    const gap = BASELINE - s.value
    const moved = Math.min(Math.abs(gap), hours * DECAY_PER_HOUR)
    s.value = clamp(s.value + Math.sign(gap) * moved)
    s.at = now
  }

  /** kind: 'praise' | 'criticism' */
  function hit(kind, now = Date.now()) {
    settle(now)
    if (kind === 'praise') { s.value = clamp(s.value + PRAISE); s.praise += 1 }
    else if (kind === 'criticism') { s.value = clamp(s.value - CRITICISM); s.criticism += 1 }
    else return null
    s.at = num(now, Date.now())
    return Number(s.value.toFixed(3))
  }

  function value(now = Date.now()) { settle(num(now, Date.now())); return Number(s.value.toFixed(3)) }

  const snapshot = () => ({ value: value(), at: s.at, praise: s.praise, criticism: s.criticism })
  const restore = (x) => {
    if (!x || typeof x !== 'object') return
    s.value = clamp(num(x.value, BASELINE))
    s.at = num(x.at, Date.now())
    s.praise = Math.max(0, num(x.praise, 0))
    s.criticism = Math.max(0, num(x.criticism, 0))
  }

  return { hit, value, settle, snapshot, restore }
}
