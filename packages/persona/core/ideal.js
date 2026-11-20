// S04 理想我 vs 现实我：差距太大时会较劲，差距小时会安心。
// 依据：读数里的 esteem/idealGap 不是摆设，得真的影响她怎么说自己。

/**
 * @param {object} reads 六器官读数（mpfc.idealGap / mpfc.esteem）
 * @returns {{ line:string|null, gap:number, because:string|null }}
 */
export function idealGap(reads = {}) {
  const n = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0)
  const mpfc = reads.mpfc || {}
  const rawGap = Number(mpfc.idealGap)
  const esteem = Number.isFinite(Number(mpfc.esteem)) ? Number(mpfc.esteem) : 0.5

  // 没有 idealGap 读数时用自尊反推：自尊越低，离"想成为的样子"越远
  const gap = Number.isFinite(rawGap) ? Math.max(0, Math.min(1, rawGap)) : Math.max(0, Math.min(1, 1 - esteem))

  if (gap > 0.45) return { line: '我还差得远，得再练', gap: Number(gap.toFixed(3)), because: 'big-gap' }
  if (gap < 0.1) return { line: '现在这样，也还行', gap: Number(gap.toFixed(3)), because: 'small-gap' }
  return { line: null, gap: Number(gap.toFixed(3)), because: 'middle' }
}
