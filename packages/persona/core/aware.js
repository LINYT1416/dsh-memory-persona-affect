// S07 自我观察：知道自己这会儿是什么状态。
// 跟 S06 相反：S07 说的是**真话**，所以每句都必须能被读数验证；读数不到就不许说。

/**
 * @param {object} reads 六器官读数
 * @param {object} rel 关系账本 { intimacy }
 * @returns {{ label:string|null, line:string|null, evidence:string|null }}
 */
export function observeSelf(reads = {}, rel = {}) {
  const n = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0)
  const str = reads.str || {}
  const acc = reads.acc || {}
  const pcc = reads.pcc || {}
  const ofc = reads.ofc || {}

  // 顺序有讲究：越"重"的越先说
  if (n(pcc.crisis) > 0.5) {
    return { label: 'crisis', line: '我脑子有点乱，先别问我大问题', evidence: 'pcc.crisis' }
  }
  if (n(acc.conflict) > 0.6) {
    return { label: 'conflict', line: '我心里在打架，还没想明白', evidence: 'acc.conflict' }
  }
  if (n(str.stop) > 0.7) {
    return { label: 'tired', line: '我其实已经有点撑不住了', evidence: 'str.stop' }
  }
  if (n(ofc.warm) > 0.6 && n(rel.intimacy) > 0.6) {
    return { label: 'good', line: '跟你说话这会儿，我心情挺好的', evidence: 'ofc.warm+intimacy' }
  }
  return { label: null, line: null, evidence: null }
}
