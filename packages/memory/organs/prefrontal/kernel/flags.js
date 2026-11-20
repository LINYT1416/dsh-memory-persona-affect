// #P5-7 降级标记：degraded / cold / truncated / shadow / restored
// 四种标必须能区分，否则日志里永远分不清"没器官"和"器官说没有"。
export const FLAGS = ['degraded', 'cold', 'truncated', 'shadow', 'restored', 'delayed']

export function tag(target, flag) {
  const list = Array.isArray(target) ? target : target?.flags
  if (!Array.isArray(list)) return target
  if (!list.includes(flag)) list.push(flag)
  return target
}

export function has(target, flag) {
  const list = Array.isArray(target) ? target : target?.flags
  return Array.isArray(list) && list.includes(flag)
}

export function merge(base = [], extra = []) {
  const out = [...base]
  for (const f of extra) if (!out.includes(f)) out.push(f)
  return out
}

/** 汇总一批 verdict 的降级情况，给宿主判断"这轮结果可不可信"。 */
export function summarize(verdicts = []) {
  const out = { degraded: 0, unknown: 0, cold: 0, truncated: 0, shadow: 0 }
  for (const v of verdicts) {
    for (const f of v.flags || []) if (f in out) out[f] += 1
  }
  return out
}
