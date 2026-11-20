// H02 仪式感：有些事是"到点就做"的，一天一次，不多也不少。
// 判据：必须真的到点（时间窗），而且当天没做过——否则不叫仪式，叫念叨。

const RITUALS = [
  { key: 'goodnight', from: 22 * 60 + 30, to: 24 * 60, line: '这个点该说晚安了' },
  { key: 'morning', from: 7 * 60, to: 9 * 60, line: '早上好，今天也慢慢来' },
  { key: 'lunch', from: 11 * 60 + 30, to: 13 * 60, line: '到饭点了，别硬扛着不吃饭' },
]

const dayKey = (d) => new Date(d).toISOString().slice(0, 10)

export function createRitual(state = {}) {
  const s = { done: state.done && typeof state.done === 'object' ? state.done : {} }

  function minutesOfDay(now) {
    const d = new Date(now)
    return d.getHours() * 60 + d.getMinutes()
  }

  /** @returns {{ key:string|null, line:string|null, because:string }} */
  function check(now = Date.now()) {
    const m = minutesOfDay(now)
    for (const r of RITUALS) {
      if (m < r.from || m >= r.to) continue
      const today = dayKey(now)
      if (s.done[r.key] === today) return { key: r.key, line: null, because: 'already-done' }
      s.done[r.key] = today
      return { key: r.key, line: r.line, because: 'due' }
    }
    return { key: null, line: null, because: 'not-yet' }
  }

  const snapshot = () => ({ done: { ...s.done } })
  const restore = (x) => { if (x && typeof x === 'object' && x.done) s.done = x.done }

  return { check, snapshot, restore }
}
