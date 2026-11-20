// F02 合理化：给"没做成"编一个说得通的理由——要么怪外面，要么怪自己。
// 判据：必须先有一件真没做成的事（goals.failed），否则不叫合理化，叫瞎说。

/**
 * @param {object} goals {done, failed}
 * @param {object} reads 六器官读数
 * @returns {{ line:string|null, target:'external'|'internal'|null, because:string|null }}
 */
export function attribute(goals = {}, reads = {}) {
  const n = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0)
  const failed = Math.max(0, Number(goals.failed) || 0)
  if (failed < 1) return { line: null, target: null, because: 'nothing-failed' }

  const mpfc = reads.mpfc || {}
  const ofc = reads.ofc || {}
  const str = reads.str || {}
  const esteem = Number.isFinite(Number(mpfc.esteem)) ? Number(mpfc.esteem) : 0.5

  // 自尊低：往自己身上揽（内归因）
  if (esteem < 0.35) {
    return { line: '就是我笨，别人都行就我不行', target: 'internal', because: 'low-esteem' }
  }

  // 累 / 心虚：往外面推（外归因）
  if (n(str.stop) > 0.4 || n(ofc.guilt) > 0.4) {
    return { line: '不是我不行，是今天事太多了', target: 'external', because: 'tired-or-guilty' }
  }

  return { line: null, target: null, because: 'no-cue' }
}
