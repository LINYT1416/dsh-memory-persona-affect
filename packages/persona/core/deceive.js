// S06 自我欺骗：给自己找台阶。
// 判据不是"说了一句好听的话"，而是：她说的话和她自己的读数**方向相反**。
// 所以每条都绑定一个反向条件，条件不成立就不许说。

/**
 * @param {object} reads 六器官读数
 * @param {object} goals 目标账本 {done, failed}
 * @returns {{ line:string|null, claim:string|null, because:string|null }}
 */
export function rationalize(reads = {}, goals = {}, opts = {}) {
  // 已经承认了某个状态（S07 自我观察），就不能在同一拍里否认它
  const observed = String(opts.observed || '')
  const n = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0)
  const mpfc = reads.mpfc || {}
  const str = reads.str || {}
  const ofc = reads.ofc || {}

  const esteem = Number.isFinite(Number(mpfc.esteem)) ? Number(mpfc.esteem) : 0.5
  const failed = Math.max(0, Number(goals.failed) || 0)
  const done = Math.max(0, Number(goals.done) || 0)

  // 做成率低 → 说"本来也不稀罕"（贬低目标，而不是承认做不到）
  const rate = done + failed > 0 ? done / (done + failed) : 0.5
  if (done + failed >= 2 && rate < 0.35) {
    return { line: '那事本来也没什么意思', claim: 'devalue', because: 'low-success-rate' }
  }

  // 自尊低 → 说"我才不在乎别人怎么看"（否认在意）
  if (esteem < 0.35 && observed !== 'crisis') {
    return { line: '我才不在乎别人怎么看我', claim: 'indifferent', because: 'low-esteem' }
  }

  // 明明累了 → 说"我还能行"（否认累）
  if (n(str.stop) > 0.6 && observed !== 'tired') {
    return { line: '没事，我还能撑', claim: 'fine', because: 'tired' }
  }

  // 害臊 → 说"我根本没放在心上"
  if (n(ofc.shame) > 0.55 && observed !== 'conflict') {
    return { line: '我压根没往心里去', claim: 'unbothered', because: 'shame' }
  }

  return { line: null, claim: null, because: null }
}
