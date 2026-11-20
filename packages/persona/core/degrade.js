// D07 模式退役：长期不用的东西自己降权，不是"还留着就当它有用"。
// D08 降级策略：器官不在的时候就冻结，不拿假的顶替。

const DAY = 86400000

/**
 * D07：给一组"最近用过"的条目，过期的降权/退役。
 * @param {Array<{key?:string, last?:number, weight?:number}>} items
 */
export function retire(items = [], now = Date.now(), { idleDays = 14, floor = 0.2 } = {}) {
  const list = Array.isArray(items) ? items : []
  const kept = []
  const retired = []
  for (const it of list) {
    if (!it || typeof it !== 'object') continue
    const last = Number(it.last)
    const key = String(it.key || '')
    if (!Number.isFinite(last)) { kept.push(it); continue }
    const days = (now - last) / DAY
    const weight = Number.isFinite(Number(it.weight)) ? Number(it.weight) : 1
    // 从用过的最后一刻起就开始衰减：闲置越久越轻，轻到地板以下就退役
    const decayed = Math.max(0, weight * Math.pow(0.5, days / idleDays))
    if (decayed <= floor) retired.push({ ...it, key, weight: decayed })
    else kept.push({ ...it, key, weight: decayed })
  }
  return { kept, retired, retiredCount: retired.length }
}

/**
 * D08：器官缺席时冻结，别编。
 * @param {{organs?:string[], present?:string[]}} h
 */
export function degrade(h = {}) {
  const organs = Array.isArray(h.organs) ? h.organs : []
  const present = Array.isArray(h.present) ? h.present : []
  const missing = organs.filter((o) => !present.includes(o))
  if (!missing.length) return { frozen: false, missing, line: null }
  // 冻结：这一拍不产出任何"读出来的情绪"，也不假装有
  return { frozen: true, missing, line: null }
}
