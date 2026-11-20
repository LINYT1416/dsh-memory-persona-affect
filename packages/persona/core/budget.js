// C08 资源预算：这一拍能分给几件事。
// 规格原文：「资源预算：这一拍能分给几件事」+「所有抢占方的需求先汇总，超了就按优先级削」

/**
 * 这一拍能说几句。
 * 状态越是占用算力（危机、崩、冲突、累），留给"说话"的名额越少——
 * 不是把话删掉，而是本来就没力气说那么多。
 */
export function speechBudget(reads = {}, base = 8) {
  const n = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0)
  const cap0 = Math.max(1, Math.round(base))

  const pcc = reads.pcc || {}
  const acc = reads.acc || {}
  const str = reads.str || {}
  const mpfc = reads.mpfc || {}
  const tpj = reads.tpj || {}

  let cap = cap0
  const why = []

  // 危机 / 崩：先保命，别铺陈
  if (n(pcc.crisis) > 0.5) { cap -= 4; why.push('crisis-4') }
  // 认知冲突 / 心里打架
  if (n(acc.conflict) > 0.5) { cap -= 2; why.push('conflict-2') }
  // 已经被冒犯：短
  if (n(tpj.offense) > 0.5) { cap -= 2; why.push('offense-2') }
  // 累 / 该停
  if (n(str.stop) > 0.6) { cap -= 2; why.push('tired-2') }
  // 低自尊：不想多说
  const esteem = Number.isFinite(Number(mpfc.esteem)) ? Number(mpfc.esteem) : 0.5
  if (esteem < 0.35) { cap -= 1; why.push('low-esteem-1') }
  // 想要很多 / 心里暖：反而想多说两句
  if (n(str.wanting) > 0.6 && n(reads.ofc && reads.ofc.warm) > 0.4) { cap += 1; why.push('warm+1') }

  return { capacity: Math.max(1, Math.min(cap0 + 1, cap)), why }
}
