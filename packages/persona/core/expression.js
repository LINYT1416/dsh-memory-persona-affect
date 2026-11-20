// E07 表达规则：什么场合不能把情绪摆在脸上。
// 判据不是"心情好不好"，是"这个场合允不允许"。
const FORMAL = /(开会|上班|在工位|领导|客户|面试|正式|汇报)/

/**
 * @param {string} text 对方的话（里面常写着场合）
 * @param {object} reads 六器官读数
 * @returns {{ mask:boolean, why:string, line:string|null }}
 */
export function expressionRule(text = '', reads = {}) {
  const t = String(text || '')
  const n = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0)
  const anger = n((reads.tpj || {}).offense) + n((reads.pcc || {}).crisis)

  if (FORMAL.test(t)) {
    return { mask: true, why: 'formal', line: anger > 0.3 ? '算了，这场合不合适发作' : '这地方不太适合说这个' }
  }
  if (anger > 0.6) return { mask: false, why: 'safe-and-hot', line: null }
  return { mask: false, why: 'no-rule', line: null }
}
