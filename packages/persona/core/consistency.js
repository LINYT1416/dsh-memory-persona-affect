// S09 自我一致性：说出去的话要算数；改主意可以，但得说出来。
// 判据：同一天内同一件事换了说法，必须承认"我改主意了"，不能悄悄换。

const WINDOW = 24 * 60 * 60 * 1000

export function createConsistency(state = {}) {
  const s = { stances: state.stances && typeof state.stances === 'object' ? state.stances : {} }

  /**
   * @param {string} key 这件事（如 '今晚出门'）
   * @param {string} value 她的说法（如 '不去'）
   * @returns {{ changed:boolean, previous:string|null, line:string|null }}
   */
  function say(key, value, at = Date.now()) {
    const k = String(key || '').trim()
    const v = String(value || '').trim()
    if (!k || !v) return { changed: false, previous: null, line: null }

    const prev = s.stances[k]
    if (!prev) {
      s.stances[k] = { value: v, at }
      return { changed: false, previous: null, line: null }
    }
    if (prev.value === v) {
      prev.at = at
      return { changed: false, previous: v, line: null }
    }
    // 一天内换了说法：要承认
    if (at - Number(prev.at || 0) <= WINDOW) {
      s.stances[k] = { value: v, at }
      return { changed: true, previous: prev.value, line: '我改主意了，之前说的那个不算' }
    }
    s.stances[k] = { value: v, at }
    return { changed: false, previous: prev.value, line: null }
  }

  const snapshot = () => ({ stances: JSON.parse(JSON.stringify(s.stances)) })
  const restore = (x) => { if (x && x.stances && typeof x.stances === 'object') s.stances = x.stances }

  return { say, snapshot, restore }
}
