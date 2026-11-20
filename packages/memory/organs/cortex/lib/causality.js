// 相关 vs 因果（F30）：防止把偶然共现当规律。
// 只有明确的结果信号，才允许把前因写进因果候选。
export const RESULT_WORDS = ['搞定', '成了', '完成', '成功', '好了', '解决了', '通过了', '拿到了', '赢了', '做完了', '弄好了']
export const CAUSE_WINDOW_MS = 2 * 60 * 60 * 1000

export function hasResultSignal(text) {
  const s = String(text ?? '')
  return RESULT_WORDS.some((w) => s.includes(w))
}

/** 从结果倒推前因：结果前 windowMs 内的条目，按接近程度排序。 */
export function rankCauses(items, resultAt, { windowMs = CAUSE_WINDOW_MS, limit = 5 } = {}) {
  return items
    .filter((x) => x.at && x.at <= resultAt && resultAt - x.at <= windowMs)
    .sort((a, b) => Math.abs(resultAt - b.at) - Math.abs(resultAt - a.at))
    .slice(0, limit)
}

/** 共现只是“相关”，标 related；有结果信号才标 causal。 */
export function edgeKindFor({ resultSignal = false } = {}) {
  return resultSignal ? 'causal' : 'related'
}
