// 跨时间统计：人格不是这一拍的读数，是这一段的平均值。
// 瞬时值给"此刻"，均值给"这个人"。两者都要，不能混。

import { clamp } from './consts.js'

export function createTracker(cfg = {}) {
  const alpha = cfg.alpha ?? 0.03      // 均值的时间常数：约 33 拍
  const volAlpha = cfg.volAlpha ?? 0.05 // 波动的时间常数

  const map = new Map()

  return {
    push(id, v) {
      if (!Number.isFinite(v)) return
      const s = map.get(id) || { mean: v, vol: 0, n: 0, flips: 0, lastSign: 0 }
      const d = v - s.mean
      const sign = Math.abs(d) < 0.002 ? 0 : Math.sign(d)
      // 翻转率才是"忽冷忽热"的正解：一直往上走和来回跳，平均绝对波动差不多，
      // 但符号翻转次数差一个量级。
      if (sign && s.lastSign && sign !== s.lastSign) s.flips += 1
      if (sign) s.lastSign = sign
      s.mean += alpha * d
      s.vol = (1 - volAlpha) * s.vol + volAlpha * Math.abs(d)
      s.n += 1
      map.set(id, s)
    },

    get(id) { return map.get(id)?.mean },
    vol(id) { return map.get(id)?.vol ?? 0 },
    n(id) { return map.get(id)?.n ?? 0 },

    all() {
      const out = {}
      for (const [k, v] of map) {
        out[k] = {
          mean: Number(v.mean.toFixed(4)),
          vol: Number(v.vol.toFixed(4)),
          flip: Number((v.n ? v.flips / v.n : 0).toFixed(4)),
          n: v.n,
        }
      }
      return out
    },

    /** 稳定度：0 = 一直在跳，1 = 一点不动。人不是 1，也不该是 0 */
    stability(ids) {
      const list = ids || [...map.keys()]
      if (!list.length) return 0
      const vols = list.map((id) => this.vol(id))
      const avg = vols.reduce((s, v) => s + v, 0) / vols.length
      return Number(clamp(1 - avg * 8, 0, 1).toFixed(4))
    },

    snapshot() {
      return [...map.entries()].map(([k, v]) => [k, { ...v }])
    },

    restore(saved) {
      if (!Array.isArray(saved)) return false
      map.clear()
      for (const [k, v] of saved) map.set(k, { ...v })
      return true
    },
  }
}
