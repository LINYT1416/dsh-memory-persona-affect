// 眶额皮层：价值与反转学习。十二条都要真跑。

import { clamp, decay, lerp, mean } from '../core/consts.js'

const DEFAULTS = {
  valueGain: 0.35,
  reversal: 0.3,
  riskBase: 0.5,
  shameBase: 0.25,
  expectRate: 0.2,
  maxKeys: 24,
}

export function create(cfg = {}) {
  const P = { ...DEFAULTS, ...cfg }
  const fresh = () => ({
    values: {}, value: 0.5, intent: 0.5,
    shame: 0, guilt: 0, warm: 0, unfair: 0,
    risk: 0.5, reversals: 0,
    expect: 0.5, expectGap: 0, favors: 0, taste: 0,
    frame: 0,
  })
  let s = fresh()

  return {
    id: 'ofc',
    cover: ['O01', 'O02', 'O03', 'O04', 'O05', 'O06', 'O07', 'O08', 'O09', 'O10', 'O11', 'O12'],
    params: P,

    step(w) {
      const dt = w.tx.dtMs
      const f = w.tx.f
      const affect = w.get('affect')
      const valence = Number.isFinite(affect?.valence)
        ? affect.valence
        : (f.warm * 0.8 - f.cold * 0.7 - f.complaint * 0.4)

      // O09 期望落差：先有预期，再拿结果对
      const actual = 0.5 + valence * 0.5
      s.expectGap = clamp((s.expect - actual) * 1.5, -1, 1)

      // O01 价值赋值
      const cue = w.tx.cue || 'talk'
      const old = s.values[cue] ?? 0.5
      const next = clamp(lerp(old, actual, P.valueGain), 0, 1)
      const flipped = (old - 0.5) * (next - 0.5) < 0 && Math.abs(next - old) > 0.08
      if (flipped) s.reversals += 1
      s.values[cue] = clamp(lerp(old, next, flipped ? 1 + P.reversal : 1), 0, 1)

      const keys = Object.keys(s.values)
      if (keys.length > P.maxKeys) {
        keys.sort((a, b) => Math.abs(s.values[a] - 0.5) - Math.abs(s.values[b] - 0.5))
        delete s.values[keys[0]]
      }
      const vals = Object.values(s.values)
      s.value = clamp(mean(vals) || 0.5, 0, 1)

      // O05 品味：价值的离散度。越集中越"有偏好"，越散越"什么都行"
      const m = mean(vals) || 0.5
      const varr = vals.length ? mean(vals.map((v) => (v - m) ** 2)) : 0
      s.taste = clamp(Math.sqrt(varr) * 4, 0, 1)

      // O06 道德情绪分档：羞耻有梯度，不是开关
      s.warm = clamp(s.warm * decay(dt, 60) + f.warm * 0.35, 0, 1)
      s.guilt = clamp(s.guilt * decay(dt, 90) + f.complaint * 0.3, 0, 1)
      s.shame = clamp(s.shame * decay(dt, 120) + f.cold * P.shameBase + f.sarcasm * 0.15, 0, 1)
      s.unfair = clamp(s.unfair * decay(dt, 120) + (f.sarcasm ? 0.45 : 0), 0, 1)

      // O11 人情账：被善待的次数，粗记
      if (f.warm || f.praise) s.favors = clamp(s.favors + 0.1, 0, 1)
      else s.favors = clamp(s.favors * decay(dt, 600), 0, 1)

      // O07 延迟折扣：太久没兑现的好，现在不值钱
      const stale = decay(dt, 240)
      s.value = clamp(s.value * (0.98 + 0.02 * stale), 0, 1)

      // 意向
      s.intent = clamp(0.5 + 0.4 * (s.value - 0.5) + 0.3 * f.warm - 0.4 * f.cold - 0.2 * f.command, 0, 1)
      // O04 风险偏好
      s.risk = clamp(P.riskBase + 0.25 * (s.warm - s.shame) + 0.1 * (s.value - 0.5), 0, 1)

      // 下一拍的预期：用这一拍的结果做锚，但只走一小步
      s.expect = clamp(lerp(s.expect, actual, P.expectRate), 0, 1)
      s.frame += 1
    },

    read() {
      const top = Object.entries(s.values)
        .map(([k, v]) => ({ cue: k, v: Number(v.toFixed(3)) }))
        .sort((a, b) => b.v - a.v)
        .slice(0, 3)
      // O06 三档
      const level = s.shame > 0.6 ? 'shame' : s.shame > 0.35 ? 'awkward' : s.shame > 0.15 ? 'uneasy' : 'none'
      return {
        frame: s.frame,
        value: Number(s.value.toFixed(3)),
        intent: Number(s.intent.toFixed(3)),
        warm: Number(s.warm.toFixed(3)),
        guilt: Number(s.guilt.toFixed(3)),
        shame: Number(s.shame.toFixed(3)),
        shameLevel: level,
        unfair: Number(s.unfair.toFixed(3)),
        risk: Number(s.risk.toFixed(3)),
        expectGap: Number(s.expectGap.toFixed(3)),
        favors: Number(s.favors.toFixed(3)),
        taste: Number(s.taste.toFixed(3)),
        reversals: s.reversals,
        top,
        spread: top.length > 1 ? Number((top[0].v - top[1].v).toFixed(3)) : 0,
        face: Number(clamp(s.shame * 0.8 + s.unfair * 0.5, 0, 1).toFixed(3)),
      }
    },

    snapshot: () => JSON.parse(JSON.stringify(s)),
    restore(o) { if (o) s = { ...fresh(), ...o } },
    health() { return { ok: true, frame: s.frame, cues: Object.keys(s.values).length } },
  }
}
