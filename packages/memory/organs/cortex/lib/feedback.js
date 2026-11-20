// 反馈环（F04、R17）：注入后回读，记“被用上/被纠正/被忽略”。
// 只读一次，不触发再注入。
const CORRECT_WORDS = ['不对', '错了', '不是', '记错', '胡说', '没有这回事', '别瞎说']

export class FeedbackTracker {
  constructor() {
    this.last = { ids: [], at: 0 }
    this.history = []
  }

  record(ids = []) {
    this.last = { ids: [...ids], at: Date.now() }
    return this.last
  }

  /** 回读用户这句话：命中被注入内容 = used；说“不对” = corrected。 */
  observe(text, now = Date.now()) {
    const s = String(text || '')
    const ids = this.last.ids
    if (!ids.length || now - this.last.at > 30 * 60 * 1000) return { used: [], corrected: [], ignored: true }
    const corrected = CORRECT_WORDS.some((w) => s.includes(w)) ? [...ids] : []
    const used = ids.filter((id) => s.includes(id))
    const out = { used, corrected, ignored: !used.length && !corrected.length }
    this.history.push({ at: now, ...out })
    this.last = { ids: [], at: 0 }
    return out
  }
}
