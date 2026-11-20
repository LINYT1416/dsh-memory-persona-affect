// 分布式表征（F05）：记忆不是一条记录，是特征群之间的共激活权重。
// cell 只存 featureIds，权重在这一层（R13）。
import { sha16, tokenize } from './util.js'

export class FeatureSpace {
  constructor() {
    this.weights = new Map() // "a|b" -> { a, b, w, at }
  }

  id(text) {
    return `f_${sha16(String(text).trim().toLowerCase())}`
  }

  addCoactivation(ids, step = 0.05) {
    const list = [...new Set(ids)].filter(Boolean)
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const a = list[i]
        const b = list[j]
        const key = a < b ? `${a}|${b}` : `${b}|${a}`
        const cur = this.weights.get(key) || { a: a < b ? a : b, b: a < b ? b : a, w: 0, at: 0 }
        cur.w = Math.min(1.5, cur.w + step)
        cur.at = Date.now()
        this.weights.set(key, cur)
      }
    }
  }

  weight(a, b) {
    const key = a < b ? `${a}|${b}` : `${b}|${a}`
    return this.weights.get(key)?.w || 0
  }

  neighbors(id) {
    const out = []
    for (const e of this.weights.values()) {
      if (e.a === id) out.push({ id: e.b, w: e.w })
      else if (e.b === id) out.push({ id: e.a, w: e.w })
    }
    return out
  }

  /** 用一组特征唤起相关特征（模式补全的皮层侧）。 */
  activate(ids, hops = 1) {
    const scores = new Map()
    let frontier = new Set(ids)
    for (let h = 0; h < hops; h++) {
      const next = new Set()
      for (const id of frontier) {
        for (const n of this.neighbors(id)) {
          scores.set(n.id, (scores.get(n.id) || 0) + n.w)
          next.add(n.id)
        }
      }
      frontier = next
      if (!frontier.size) break
    }
    return [...scores.entries()].sort((x, y) => y[1] - x[1])
  }

  toJSON() {
    return [...this.weights.values()]
  }

  load(rows = []) {
    for (const r of rows) {
      const key = r.a < r.b ? `${r.a}|${r.b}` : `${r.b}|${r.a}`
      this.weights.set(key, r)
    }
  }
}

/** 一条文本 → 特征 id 列表（词 + 2/3-gram）。 */
export function featuresOf(text) {
  return tokenize(text).map((t) => `f_${sha16(t)}`)
}
