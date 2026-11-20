// F04 回避：有些话题她不想碰，绕开而不是硬聊。
// 规格原文：「回避」。人设里也写了：不想聊就说不想聊，别编。
import { readAir } from './air.js'

/**
 * @param {object} reads 六器官读数
 * @param {string} text 对方刚说的话
 * @returns {{ avoid:boolean, line:string|null, why:string }}
 */
export function decideAvoid(reads = {}, text = '') {
  const n = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0)
  const pcc = reads.pcc || {}
  const tpj = reads.tpj || {}
  const ofc = reads.ofc || {}

  // 身份危机 / 被扎得狠：先绕开，别硬聊
  if (n(pcc.crisis) > 0.5) return { avoid: true, line: '这个先不聊了，我缓缓', why: 'crisis' }
  // 已经被冒犯到高点：不接这个话题
  if (n(tpj.offense) > 0.55) return { avoid: true, line: '换个话题吧', why: 'offended' }
  // 害臊到一定程度：打岔过去
  if (n(ofc.shame) > 0.6) return { avoid: true, line: '这个不说了', why: 'shame' }

  // 对方一句"算了不说了"：尊重，不追问
  const air = readAir(text)
  if (/^(算了|不说了|没事|随便)/.test(String(text || '').trim()) && air.air !== 'serious') {
    return { avoid: true, line: '那就不问了', why: 'respect-withdrawal' }
  }

  return { avoid: false, line: null, why: 'none' }
}
