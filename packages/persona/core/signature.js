// if-then 签名：人格最像人的地方不是"她外向"，是"被批评的时候她会变硬"。
// 白纸 = 所有签名强度 0。强度只能靠重复长出来，不能预置。

import { clamp } from './consts.js'

export const BASE = [
  { id: 'cold→hard', when: 'cold', axis: 'brevity', dir: 1 },
  { id: 'warm→soft', when: 'warm', axis: 'warmth', dir: 1 },
  { id: 'command→resist', when: 'command', axis: 'blunt', dir: 1 },
  { id: 'complaint→quiet', when: 'complaint', axis: 'brevity', dir: 1 },
  { id: 'praise→up', when: 'praise', axis: 'warmth', dir: 1 },
  { id: 'question→explain', when: 'question', axis: 'brevity', dir: -1 },
  { id: 'sarcasm→guard', when: 'sarcasm', axis: 'blunt', dir: 1 },
]

export function createSignatures(cfg = {}) {
  const gain = cfg.gain ?? 0.09
  const decay = cfg.decay ?? 0.03
  const activeAt = cfg.activeAt ?? 0.3
  const effect = cfg.effect ?? 0.3

  let sigs = BASE.map((s) => ({ ...s, strength: 0, hits: 0 }))
  const baseline = {}

  return {
    list: () => sigs.map((s) => ({ ...s })),

    /**
     * 学：条件出现时，看实际输出是不是往那个方向偏了。
     * 偏了就算一次证据，没偏就掉一点。基线是慢的，所以"偏"是相对她自己。
     */
    learn(f, hex) {
      for (const [k, v] of Object.entries(hex)) {
        if (typeof v !== 'number') continue
        baseline[k] = (baseline[k] ?? v) * 0.97 + v * 0.03
      }
      for (const s of sigs) {
        if (!f || !f[s.when]) {
          s.strength = Math.max(0, s.strength - decay * 0.3)
          continue
        }
        const v = hex[s.axis]
        if (typeof v !== 'number') continue
        const b = baseline[s.axis] ?? v
        const dev = v - b
        const good = s.dir > 0 ? dev > 0.01 : dev < -0.01
        s.hits += 1
        s.strength = clamp(s.strength + (good ? gain : -decay), 0, 1)
      }
    },

    /** 用：只有长出来的签名才改输出。没长出来的，白纸就是白纸 */
    apply(hex, f) {
      const out = { ...hex }
      for (const s of sigs) {
        if (s.strength < activeAt || !f || !f[s.when]) continue
        const v = out[s.axis]
        if (typeof v !== 'number') continue
        out[s.axis] = clamp(v + s.dir * s.strength * effect, 0, 1)
      }
      return out
    },

    strongest(n = 3) {
      return sigs
        .filter((s) => s.strength > activeAt)
        .sort((a, b) => b.strength - a.strength)
        .slice(0, n)
        .map((s) => ({ id: s.id, strength: Number(s.strength.toFixed(3)), hits: s.hits }))
    },

    activeCount() {
      return sigs.filter((s) => s.strength > activeAt).length
    },

    snapshot() {
      return { sigs: JSON.parse(JSON.stringify(sigs)), baseline: { ...baseline } }
    },

    restore(saved) {
      if (!saved || !Array.isArray(saved.sigs)) return false
      sigs = saved.sigs.map((s) => ({ ...s }))
      Object.assign(baseline, saved.baseline || {})
      return true
    },
  }
}
