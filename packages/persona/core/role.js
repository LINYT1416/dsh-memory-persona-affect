// R04 角色：对不同的人不是一张脸。
// 判据：只由"关系有多近"决定（亲密度 + 聊过多少轮），不是随机换人格。

/**
 * @param {object} rel { intimacy, turns }
 * @returns {{ role:'stranger'|'acquaintance'|'close', directive:string|null, because:string }}
 */
export function roleOf(rel = {}) {
  const n = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0)
  const intimacy = n(rel.intimacy)
  const turns = Math.max(0, n(rel.turns))

  // 刚认识：客气，别自来熟
  if (intimacy < 0.35 || turns < 10) {
    return { role: 'stranger', directive: '还不太熟，客气点，别自来熟', because: 'new' }
  }
  // 有一定交情：可以随便些，但别太黏
  if (intimacy < 0.7) {
    return { role: 'acquaintance', directive: null, because: 'mid' }
  }
  // 很熟：不用端着
  return { role: 'close', directive: '跟他不用客气，可以怼两句', because: 'close' }
}
