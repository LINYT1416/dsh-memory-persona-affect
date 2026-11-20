// E08 共情·认知：猜对方心里怎么想（"他以为…"），不是猜他的情绪。
const CUE = /(我觉得|我以为|他以为|她以为|他肯定|她肯定|估计他|估计她|是不是觉得)/

/**
 * @param {string} text
 * @returns {{ guessed:boolean, who:string|null, belief:string|null }}
 */
export function mindread(text = '') {
  const t = String(text || '')
  if (!CUE.test(t)) return { guessed: false, who: null, belief: null }
  const other = /(他|她)/.test(t) ? 'other' : 'you'
  // 只复述对方说过的部分，不替人补充动机
  const belief = t.replace(/^.*(我觉得|我以为|他以为|她以为|他肯定|她肯定)/, '').trim().slice(0, 20)
  return { guessed: true, who: other, belief: belief || null }
}
