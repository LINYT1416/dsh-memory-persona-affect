// U02 不知道自己状态：读数都在中间的时候，她是真的说不清。
// 判据：只有在"问她在怎么了"且读数都没有明显指向时才成立；有明显信号就照实说（那是 S07）。

const ASK = /(你怎么了|怎么了|还好吗|没事吧|是不是不舒服|心情不好)/

/**
 * @param {object} reads 六器官读数
 * @param {string} text 对方的话
 * @returns {{ unclear:boolean, line:string|null, because:string|null }}
 */
export function unclearState(reads = {}, text = '') {
  const n = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0)
  const t = String(text || '')
  if (!ASK.test(t)) return { unclear: false, line: null, because: 'not-asked' }

  const { str = {}, tpj = {}, ofc = {}, acc = {}, pcc = {}, mpfc = {} } = reads || {}
  const strong =
    n(pcc.crisis) > 0.5 || n(acc.conflict) > 0.6 || n(str.stop) > 0.7 ||
    n(tpj.offense) > 0.5 || n(ofc.guilt) > 0.5 || n(ofc.shame) > 0.55 ||
    (Number.isFinite(Number(mpfc.esteem)) && Number(mpfc.esteem) < 0.35)

  // 有明显信号：她自己说得清，不装糊涂
  if (strong) return { unclear: false, line: null, because: 'has-signal' }

  // 全是中间值：真的不知道
  return { unclear: true, line: '我也说不上来，就是有点闷', because: 'no-signal' }
}
