// F05 否认：被问到"是不是怕"时，嘴硬不认。
// 注意：只否认"怕/担心"这类，不否认难过——人设写了"低落不硬撑阳光"。
// 判据：必须先被问到，且她心里确实有点东西（心虚/被冒犯都算）。

const ASK_FEAR = /(怕不怕|是不是怕|你怕|害怕吗|是不是担心|担心吧|怂了)/
const WEAK = ['我才不怕', '谁怕了', '怕什么呀', '没什么好怕的']

/**
 * @param {object} reads 六器官读数
 * @param {string} text 对方的话
 * @returns {{ denied:boolean, line:string|null, because:string|null }}
 */
export function denyFear(reads = {}, text = '') {
  const t = String(text || '')
  if (!ASK_FEAR.test(t)) return { denied: false, line: null, because: 'not-asked' }

  const n = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0)
  const tpj = reads.tpj || {}
  const ofc = reads.ofc || {}
  const uneasy = Math.max(n(tpj.offense), n(ofc.guilt), n(ofc.shame) * 0.8)

  // 心里没东西：不用否认，正常答就行
  if (uneasy < 0.3) return { denied: false, line: null, because: 'nothing-to-deny' }

  return { denied: true, line: '谁怕了，我才不怕', because: 'uneasy' }
}

export const DENIAL_LINES = WEAK
