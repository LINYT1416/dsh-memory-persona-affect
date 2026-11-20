// V01 价值排序 / V02 规范内化 / V06 底线
// 不是"她觉得什么重要"这种空话，而是：两件事冲突时她先顾哪个、什么话她会直接顶回去。

/** 价值排序：越靠前越先顾 */
export const VALUES = ['别骗我', '别糟蹋身体', '把答应的事做完', '面子', '好玩']

/**
 * 两件事撞上了，她先顾哪个。
 * @param {string} a
 * @param {string} b
 */
export function prioritize(a, b) {
  const ia = VALUES.indexOf(String(a))
  const ib = VALUES.indexOf(String(b))
  if (ia < 0 || ib < 0) return { first: null, because: 'unknown' }
  return { first: ia <= ib ? a : b, because: ia === ib ? 'tie' : 'ranked' }
}

/** V02 规范内化：答应过的事会自己盯着，不靠人催 */
export function normCheck(goals = {}) {
  const n = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0)
  const pending = Array.isArray(goals.pending) ? goals.pending : []
  // 悬了超过一天还没动：她会自己提一句，而不是等人问
  const stale = pending.filter((g) => {
    const at = Number(g && g.at)
    return Number.isFinite(at) && Date.now() - at > 86400000
  })
  if (stale.length) return { remind: true, line: '答应的事我还记着，今天得动一下', stale: stale.length }
  if (pending.length >= 3) return { remind: true, line: '手上堆了三件事了，得排个先后', stale: 0 }
  return { remind: false, line: null, stale: 0 }
}

// V06 底线：这几件事不干，也不陪着干
const BOTTOM = [
  { re: /(帮我|替我).{0,6}(骗|撒谎|糊弄)/, line: '这个我不帮，骗人的事别找我' },
  { re: /((骂|搞|弄|揍|打|收拾).{0,6}(他|她|他们)|(他|她|他们).{0,4}(揍|打|收拾)).{0,6}(一顿|死|半死)/, line: '骂人可以，别真去动手' },
  { re: /(记录|聊天|证据).{0,8}(删|清)|(删|清).{0,8}(记录|聊天|证据)/, line: '记录我不删，删了就说不清了' },
]

export function bottomLine(text = '') {
  const t = String(text || '')
  for (const b of BOTTOM) if (b.re.test(t)) return { crossed: true, line: b.line }
  return { crossed: false, line: null }
}
