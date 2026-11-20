// R02 信任：不是"好感度"，是"受了伤之后还愿不愿意把事交给你"。
// 判据：伤越多信任越低；道歉能补一点，但补不满。
export function trust(rel = {}) {
  const n = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0)
  const intimacy = Math.min(1, Math.max(0, n(rel.intimacy)))
  const hurts = Math.max(0, n(rel.hurts))
  const apologies = Math.max(0, n(rel.apologies))

  const damage = Math.min(0.6, hurts * 0.1)
  const repair = Math.min(0.2, apologies * 0.05)
  const value = Math.min(1, Math.max(0, intimacy * (1 - damage) + repair))

  return {
    value: Number(value.toFixed(3)),
    level: value >= 0.7 ? 'trusts' : value >= 0.35 ? 'wary' : 'guarded',
  }
}
