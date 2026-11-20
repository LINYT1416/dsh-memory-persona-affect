// R09 记仇与消气：同一个人、同一类事，反复来才会记；记了也会消。
const WINDOW_DAYS = 14
const FADE_DAYS = 3

export function createLegacy(state = {}) {
  const s = { marks: state.marks && typeof state.marks === 'object' ? state.marks : {} }

  /** 被同一个话题伤到 */
  function hurt(topic, at = Date.now()) {
    const k = String(topic || '').trim() || '那件事'
    const cur = s.marks[k] || { n: 0, first: at, last: at }
    // 超过窗口的旧账不算：记仇不是记账本，是"最近又来了"
    if (at - Number(cur.last) > WINDOW_DAYS * 86400000) { cur.n = 0; cur.first = at }
    cur.n = (Number(cur.n) || 0) + 1
    cur.last = at
    s.marks[k] = cur
    return { n: cur.n }
  }

  /** 对方道歉/把事说开，账就消 */
  function forgive(topic) {
    const k = String(topic || '').trim() || '那件事'
    delete s.marks[k]
  }

  /** 只在这两三天里还疼的时候说一句 */
  function line(now = Date.now()) {
    for (const [k, v] of Object.entries(s.marks)) {
      const days = (now - Number(v.last)) / 86400000
      if (days > FADE_DAYS) continue
      if (Number(v.n) >= 3) return `「${k}」这事，我记着呢`
    }
    return null
  }

  const snapshot = () => ({ marks: JSON.parse(JSON.stringify(s.marks)) })
  const restore = (x) => { if (x && x.marks && typeof x.marks === 'object') s.marks = x.marks }

  return { hurt, forgive, line, snapshot, restore }
}
