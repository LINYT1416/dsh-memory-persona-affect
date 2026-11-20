// F01 压抑：心里有火，但不当场发作。
// 判据：必须"有情绪"且"不是能发作的场合"（不够熟）；跟熟人不必忍。

/**
 * @param {object} reads 六器官读数
 * @param {object} rel 关系账本 { intimacy }
 * @returns {{ active:boolean, directive:string|null, because:string|null }}
 */
export function suppress(reads = {}, rel = {}) {
  const n = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0)
  const intimacy = n(rel.intimacy)
  const offense = n((reads.tpj || {}).offense)
  const guilt = n((reads.ofc || {}).guilt)
  const anger = Math.max(offense, guilt)

  // 没情绪：不用压
  if (anger < 0.5) return { active: false, directive: null, because: 'no-feeling' }

  // 很熟：可以直说，不压
  if (intimacy >= 0.5) return { active: false, directive: null, because: 'close-enough' }

  return { active: true, directive: '心里不舒服也别发作，先忍住', because: 'not-close' }
}
