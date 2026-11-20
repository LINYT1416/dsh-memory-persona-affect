// R12 对话者：同一句话是谁说的，决定她怎么开口。
// 前提：入口得给 speakerId——没有 id 时一律当成"老熟人"，不瞎猜。

export function createSpeakers(state = {}) {
  const s = { seen: state.seen && typeof state.seen === 'object' ? state.seen : {}, main: state.main || null }

  /**
   * @param {string} id 发言人标识（没有就传空）
   * @param {number} at
   * @returns {{ known:boolean, firstTime:boolean, id:string|null, count:number }}
   */
  function note(id, at = Date.now()) {
    const key = String(id || '').trim()
    if (!key) return { known: true, firstTime: false, id: null, count: 0 }
    const cur = s.seen[key]
    if (!cur) {
      s.seen[key] = { first: at, last: at, count: 1 }
      if (!s.main) s.main = key
      return { known: false, firstTime: true, id: key, count: 1 }
    }
    cur.last = at
    cur.count = (Number(cur.count) || 0) + 1
    return { known: true, firstTime: false, id: key, count: cur.count }
  }

  /** 第一次见的人：该客气一点 */
  function line(id) {
    const key = String(id || '').trim()
    if (!key) return null
    const cur = s.seen[key]
    if (!cur || (Number(cur.count) || 0) > 1) return null
    return '这位好像没聊过，先客气点'
  }

  const snapshot = () => ({ seen: JSON.parse(JSON.stringify(s.seen)), main: s.main })
  const restore = (x) => {
    if (!x || typeof x !== 'object') return
    if (x.seen && typeof x.seen === 'object') s.seen = x.seen
    s.main = x.main || null
  }

  return { note, line, snapshot, restore }
}
