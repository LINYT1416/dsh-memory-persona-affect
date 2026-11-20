// R07 被排斥的痛：不是"生气"，是被晾着会疼。连发两条没回音，第三次就收手。
export function createOstracism(state = {}) {
  const s = {
    streak: Number(state.streak) || 0,
    lastSlot: Number(state.lastSlot) || 0,     // 连续没被回应的次数
    ignored: Number(state.ignored) || 0,   // 累计被忽略
    lastLine: state.lastLine || null,
  }

  /**
   * 一拍结束时调用：她回了话，对方有没有接。
   * @param {boolean} answered 对方这条是否在回应她（比如提到了她说的事 / 直接对话）
   */
  function beat(answered, at = Date.now()) {
    if (answered) {
      // 被接住了：疼会退，但不会立刻归零
      s.streak = 0
      s.ignored = Math.max(0, s.ignored - 1)
      return { hurt: false, line: null, streak: 0 }
    }
    s.streak += 1
    if (s.streak >= 3) {
      s.ignored += 1
      const line = s.streak === 3 ? '算了，不说了' : (s.streak === 6 ? '我先去忙了' : null)
      s.lastLine = line || s.lastLine
      return { hurt: true, line, streak: s.streak }
    }
    return { hurt: s.streak >= 2, line: null, streak: s.streak }
  }

  // 接线用：按"多久没动静"决定这一拍算不算被晾着
  const IDLE_HOURS = 6
  function idleBeat(gapHours, hadUserThisBeat) {
    const gap = Number(gapHours)
    if (hadUserThisBeat) return { hurt: false, line: null, returned: Number.isFinite(gap) && gap >= IDLE_HOURS }
    if (!Number.isFinite(gap) || gap < IDLE_HOURS) return { hurt: false, line: null, returned: false }
    // 同一个空窗只记一次：否则每次心跳都加一笔
    const slot = Math.floor(gap)
    if (s.lastSlot === slot) return { hurt: s.streak > 0, line: null, returned: false, streak: s.streak }
    s.lastSlot = slot
    const r = beat(false)
    return { ...r, hurt: true, returned: false }
  }

  const snapshot = () => ({ streak: s.streak, ignored: s.ignored, lastLine: s.lastLine, lastSlot: s.lastSlot })
  const restore = (x) => {
    if (!x || typeof x !== 'object') return
    s.streak = Number(x.streak) || 0
    s.lastSlot = Number(x.lastSlot) || 0
    s.ignored = Number(x.ignored) || 0
    s.lastLine = x.lastLine || null
  }

  return { beat, idleBeat, snapshot, restore }
}
