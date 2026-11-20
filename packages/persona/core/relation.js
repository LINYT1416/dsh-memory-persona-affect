// 关系账本：谁帮过谁、欠不欠人情、熟到什么程度。
// 只记账，不做判断；账面变了才说一句话，不刷屏。
const DAY = 24 * 60 * 60 * 1000

// 他对我好 / 我对他好 —— 只用最硬的词，别把普通客气当人情
const CUES = [
  { kind: 'received', re: /(谢谢你?|多谢|麻烦你|帮我|替我|你真好|辛苦了)/ },
  { kind: 'given', re: /(我帮你|帮你弄|给你弄|替你|我来吧|交给我)/ },
  { kind: 'apology', re: /(对不起|抱歉|我错了|是我不好)/ },
  // 伤人的话要放宽：真实说法是「你是真的很烦」这种，不是只有「你很烦」三个字
  { kind: 'hurt', re: /(烦不烦|烦死|闭嘴|别说了|你(?:是)?(?:真的|真)?很?烦|滚)/ },
]

export function createRelation(state = {}) {
  const s = {
    debt: 0,          // >0 他帮过我，<0 我帮过他
    intimacy: 0.2,    // 0..1
    turns: 0,
    apologies: 0,
    hurts: 0,
    lastNoteAt: 0,
    lastHurtAt: 0,
    lastApologyAt: 0,
    ...state,
  }
  const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v)

  function note(text, at = Date.now()) {
    const t = String(text || '')
    let changed = false
    for (const c of CUES) {
      if (!c.re.test(t)) continue
      changed = true
      if (c.kind === 'received') s.debt = clamp(s.debt + 1, -20, 20)
      if (c.kind === 'given') s.debt = clamp(s.debt - 1, -20, 20)
      if (c.kind === 'apology') { s.apologies += 1; s.debt = clamp(s.debt + 1, -20, 20); s.lastApologyAt = at }
      if (c.kind === 'hurt') { s.hurts += 1; s.intimacy = clamp(s.intimacy - 0.05, 0, 1); s.lastHurtAt = at }
    }
    s.turns += 1
    // 说满 20 句算熟一层；被伤到会掉
    s.intimacy = clamp(s.intimacy + 0.01 + (changed ? 0.01 : 0), 0, 1)
    if (changed) s.lastNoteAt = at
    return { changed, debt: s.debt, intimacy: Number(s.intimacy.toFixed(3)) }
  }

  // 只有「明显欠着」或「明显被伤到」才说一句，避免每轮都念账
  function line() {
    if (s.debt >= 3) return `还欠着他 ${s.debt} 次人情，记着`
    if (s.debt <= -3) return `他欠我 ${Math.abs(s.debt)} 次，别装不记得`
    if (s.hurts > 0 && s.hurts % 3 === 0) return '刚才那话说重了，心里记着'
    // 他伤过我，但之后道过歉：账翻篇，不要反复拿出来
    if (s.hurts > 0 && s.lastApologyAt > s.lastHurtAt) return '他道过歉了，这事翻篇'
    return null
  }

  const snap = () => ({ debt: s.debt, intimacy: Number(s.intimacy.toFixed(3)), turns: s.turns, apologies: s.apologies, hurts: s.hurts, lastNoteAt: s.lastNoteAt, lastHurtAt: s.lastHurtAt, lastApologyAt: s.lastApologyAt })

  return { note, line, snapshot: snap, restore: (x) => Object.assign(s, x || {}) }
}
