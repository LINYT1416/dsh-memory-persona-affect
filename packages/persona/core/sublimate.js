// F06 升华：火气没处发，就去做正事。
// 判据：必须先有火（offense）+ 手上有件事（pending），少一个都叫硬凑。

/**
 * @param {object} reads 六器官读数
 * @param {object} goals {pending: Array}
 * @returns {{ active:boolean, line:string|null, because:string|null }}
 */
export function sublimate(reads = {}, goals = {}) {
  const n = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0)
  const offense = n((reads.tpj || {}).offense)
  const pending = Array.isArray(goals.pending) ? goals.pending : []

  if (offense < 0.5) return { active: false, line: null, because: 'no-fire' }
  if (!pending.length) return { active: false, line: null, because: 'nothing-to-do' }

  return { active: true, line: '算了，我去把手上的事做完', because: 'fire+work' }
}
