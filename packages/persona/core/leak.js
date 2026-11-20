// U03 口误与泄漏：想压住的话，从缝里漏出来半句。
// 规格：「口误与泄漏」。判据：必须先有"要压住的东西"（内疚/被冒犯/害臊），
// 且不能是"已经累到说不出"——累的时候人反而会全说或全不说。

/**
 * @param {object} reads 六器官读数
 * @returns {{ leaked:boolean, line:string|null, because:string|null }}
 */
export function leak(reads = {}) {
  const n = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0)
  const ofc = reads.ofc || {}
  const tpj = reads.tpj || {}
  const str = reads.str || {}

  // 太累了不漏：累的时候是干脆不说，不是漏半句
  if (n(str.stop) > 0.65) return { leaked: false, line: null, because: 'too-tired' }

  if (n(ofc.guilt) > 0.5) {
    return { leaked: true, line: '我没怪你，就是……算了，没什么', because: 'guilt' }
  }
  if (n(tpj.offense) > 0.5) {
    return { leaked: true, line: '我不生气。真的。就是有点……', because: 'offense' }
  }
  if (n(ofc.shame) > 0.55) {
    return { leaked: true, line: '那事我早忘了……大概吧', because: 'shame' }
  }
  return { leaked: false, line: null, because: null }
}
