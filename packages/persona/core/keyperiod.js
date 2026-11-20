// D03 创伤与关键期：短时间里被扎了很多次，会留下一段"过不去"的时期。
// 判据：不是"被扎一次就算创伤"——要在一周内密集发生，而且会随时间淡掉。

const WINDOW = 7 * 24 * 60 * 60 * 1000
const THRESHOLD = 3
const FADE = 30 * 24 * 60 * 60 * 1000

export function createKeyPeriod(state = {}) {
  const s = {
    hits: Array.isArray(state.hits) ? state.hits.slice(-50) : [],
    markedAt: Number(state.markedAt) || 0,
  }

  function note(at = Date.now()) {
    s.hits.push(at)
    // 只留窗口内的，避免无限长
    s.hits = s.hits.filter((t) => Number.isFinite(t) && at - t <= WINDOW)
    if (s.hits.length >= THRESHOLD && !s.markedAt) {
      s.markedAt = at
      return { marked: true, count: s.hits.length }
    }
    return { marked: false, count: s.hits.length }
  }

  function active(now = Date.now()) {
    if (!s.markedAt) return false
    return now - s.markedAt <= FADE
  }

  function line(now = Date.now()) {
    return active(now) ? '那阵子的事，我到现在还没完全过去' : null
  }

  const snapshot = () => ({ hits: s.hits.slice(-50), markedAt: s.markedAt })
  const restore = (x) => {
    if (!x || typeof x !== 'object') return
    s.hits = Array.isArray(x.hits) ? x.hits.filter(Number.isFinite).slice(-50) : []
    s.markedAt = Number(x.markedAt) || 0
  }

  return { note, active, line, snapshot, restore }
}
