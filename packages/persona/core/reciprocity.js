// R05 互惠账本：谁欠谁不是记账软件，是"我记得你给过什么"。
export function createReciprocity(state = {}) {
  const s = {
    owed: Number(state.owed) || 0,       // 正数=她欠对方；负数=对方欠她
    entries: Array.isArray(state.entries) ? state.entries.slice(-20) : [],
  }

  /** 对方给了她什么（帮忙、请客、记得她的事） */
  function receive(what, at = Date.now()) {
    s.owed += 1
    s.entries.push({ dir: 'in', what: String(what || '').slice(0, 40), at })
    return snapshot()
  }

  /** 她还了什么 */
  function repay(what, at = Date.now()) {
    s.owed = Math.max(0, s.owed - 1)
    s.entries.push({ dir: 'out', what: String(what || '').slice(0, 40), at })
    return snapshot()
  }

  /** 欠得明显 / 刚好还清时，才说一句 */
  function line() {
    if (s.owed >= 2) return '我记着呢，回头得还你个人情'
    if (s.owed === 1) return '上次那事我还没谢你'
    if (s.owed === 0 && s.entries.some((e) => e.dir === 'out')) return '人情我还上了，两清'
    return null
  }

  function snapshot() { return { owed: s.owed, entries: s.entries.slice(-5) } }
  function restore(x) {
    if (!x || typeof x !== 'object') return
    s.owed = Number(x.owed) || 0
    s.entries = Array.isArray(x.entries) ? x.entries.slice(-20) : []
  }

  return { receive, repay, line, snapshot, restore }
}
