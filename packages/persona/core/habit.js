// H01 行为固化：同一件事在不同天反复做，才会变"不用想就做"。
// 关键判据：一口气做三次不算习惯；跨天才算。中间断了会退化。

const WINDOW_DAYS = 14      // 两周内
const MIN_DAYS = 3          // 至少跨三天
const DAY = 24 * 60 * 60 * 1000
const DECAY_DAYS = 7        // 七天没做，习惯开始退化

const dayKey = (t) => new Date(t).toISOString().slice(0, 10)

export function createHabit(state = {}) {
  const s = { cues: {}, ...state }

  function note(cue, at = Date.now()) {
    const k = String(cue || '').trim()
    if (!k) return { cue: null, days: 0, habit: false }
    const cur = s.cues[k] && typeof s.cues[k] === 'object' ? s.cues[k] : { days: [], last: 0 }
    // 两周一过就重来：太久没做的事不算还在做
    if (cur.last && at - cur.last > WINDOW_DAYS * DAY) cur.days = []
    const d = dayKey(at)
    if (!cur.days.includes(d)) cur.days.push(d)
    cur.last = at
    s.cues[k] = cur
    return { cue: k, days: cur.days.length, habit: cur.days.length >= MIN_DAYS }
  }

  function isHabit(cue, at = Date.now()) {
    const cur = s.cues[String(cue || '')]
    if (!cur || !Array.isArray(cur.days)) return false
    if (at - (cur.last || 0) > DECAY_DAYS * DAY) return false
    return cur.days.length >= MIN_DAYS
  }

  function line(cue, at = Date.now()) {
    return isHabit(cue, at) ? '这事不用想，手已经先动了' : null
  }

  const snapshot = () => ({ cues: JSON.parse(JSON.stringify(s.cues)) })
  const restore = (x) => {
    if (x && typeof x === 'object' && x.cues && typeof x.cues === 'object') s.cues = x.cues
  }

  return { note, isHabit, line, snapshot, restore }
}
