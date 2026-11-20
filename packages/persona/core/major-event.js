// D06 重大事件：小事会过去，但有的会把已经定型的那块撬开。
// 判据：单次冲击够大（>=0.7）才算；一天内多次中等冲击不算（那是 D03 关键期的事）。
export function createMajorEvent(state = {}) {
  const s = {
    events: Array.isArray(state.events) ? state.events.slice(-10) : [],
  }
  const THRESHOLD = 0.7
  const FADE_DAYS = 30

  /**
   * @param {number} impact 这次冲击多大（0~1）
   * @param {string} what 什么事
   */
  function hit(impact, what = '', at = Date.now()) {
    const n = Number(impact)
    if (!Number.isFinite(n) || n < THRESHOLD) return { major: false, line: null }
    s.events.push({ impact: Math.min(1, n), what: String(what).slice(0, 40), at })
    return { major: true, line: '这件事之后，我不太一样了' }
  }

  /** 最近一次重大事件还在不在有效期内 */
  function line(now = Date.now()) {
    const e = s.events[s.events.length - 1]
    if (!e) return null
    const days = (now - Number(e.at)) / 86400000
    if (days > FADE_DAYS) return null
    return `那件${e.what ? '「' + e.what + '」' : '事'}，我到现在还记着`
  }

  const snapshot = () => ({ events: s.events.slice(-5) })
  const restore = (x) => {
    if (x && Array.isArray(x.events)) s.events = x.events.slice(-10)
  }

  return { hit, line, snapshot, restore }
}
