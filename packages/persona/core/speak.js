// X12 发言决策：说、不说、说几条。
// 规格原文：「发言决策：说、不说、什么时候说、说几条」
// 这里只出"这一条回几句"的建议，不写成字数硬约束；宁可少说，不硬凑。

/**
 * @param {object} reads 六器官读数
 * @param {object} opts  { max: 上限（面板 injectMax 不相关，这里指回复句数上限）， mode }
 * @returns {{ lines: number, why: string, directive: string|null }}
 */
export function decideSpeak(reads = {}, opts = {}) {
  const max = Number(opts.max) || 3
  const n = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0)
  const str = reads.str || {}
  const tpj = reads.tpj || {}
  const ofc = reads.ofc || {}
  const acc = reads.acc || {}
  const pcc = reads.pcc || {}
  const mpfc = reads.mpfc || {}

  const clamp = (x, lo, hi) => (x < lo ? lo : x > hi ? hi : x)

  // 急、崩、身份危机：一句就够，别铺陈
  if (n(pcc.crisis) > 0.4) return { lines: 1, why: 'crisis', directive: '这条就一句，别铺' }
  // 已被冒犯：短、直，但别冷到像机器
  if (n(tpj.offense) > 0.5) return { lines: clamp(1 + (n(str.wanting) > 0.5 ? 1 : 0), 1, 2), why: 'offense', directive: '这条短点，直说' }
  // 心里暖、想分享：可以两句
  if (n(ofc.warm) > 0.5 && n(str.wanting) > 0.4) return { lines: clamp(2, 1, max), why: 'warm+want', directive: '这条可以多说一句' }
  // 累了、快没电：只答一句
  // esteem 的默认是 0.5：缺读数不能当成 0，否则"平常"会被判成"累"
  const esteem = Number.isFinite(Number(mpfc.esteem)) ? Number(mpfc.esteem) : 0.5
  if (n(str.stop) > 0.55 || esteem < 0.35) return { lines: 1, why: 'tired', directive: '这条一句就好' }
  // 冲突/别扭：先别多说
  if (n(acc.conflict) > 0.5) return { lines: 1, why: 'conflict', directive: '这条先别多说' }
  // 没什么可说的：允许沉默式回应
  if (n(str.wanting) < 0.2 && n(ofc.warm) < 0.2 && n(tpj.offense) < 0.2) {
    return { lines: 1, why: 'flat', directive: null }
  }
  return { lines: clamp(1 + (n(str.wanting) > 0.55 ? 1 : 0), 1, max), why: 'default', directive: null }
}
