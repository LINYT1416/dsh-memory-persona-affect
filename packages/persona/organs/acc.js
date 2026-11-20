// 前扣带：冲突与错误监测。
// 发现"不对劲"就发三个信号：要带宽、要 NE、报不舒服。十二条都要真跑。

import { clamp, decay } from '../core/consts.js'

const DEFAULTS = {
  conflictGain: 0.9,
  errorTauMin: 8,
  adjustGain: 0.5,
  stickiness: 0.55,
  effortGain: 0.4,
  expectWindow: 3,
}

export function create(cfg = {}) {
  const P = { ...DEFAULTS, ...cfg }
  const fresh = () => ({
    conflict: 0, error: 0, adjusting: 0, sticky: P.stickiness,
    effort: 0.3, lastValence: 0,
    expect: null, expectAge: 0, surprise: 0,
    monitor: 0, compulsion: 0, socialClash: 0, commitment: 0, pain: 0,
    lastClaim: null, conflicts: 0, frame: 0,
  })
  let s = fresh()

  return {
    id: 'acc',
    cover: ['A01', 'A02', 'A03', 'A04', 'A05', 'A06', 'A07', 'A08', 'A09', 'A10', 'A11', 'A12'],
    params: P,

    step(w) {
      const dt = w.tx.dtMs
      const f = w.tx.f

      // A01 反应冲突：习惯想干的和价值想要的不一样
      const primed = w.get('str')?.primed ?? 0
      const intent = w.get('ofc')?.intent ?? 0.5
      const raw = primed > 0.05 ? Math.abs(primed - intent) : 0
      if (raw > 0.35) s.conflicts += 1
      s.conflict = clamp(raw * P.conflictGain + (f.sarcasm ? 0.3 : 0), 0, 1)

      // A02 错误监测：情绪效价翻面 = 猜错了
      const val = Number(w.affect?.valence ?? w.get('affect')?.valence ?? 0)
      if (s.lastValence !== 0 && Math.sign(val) !== Math.sign(s.lastValence) && Math.abs(val - s.lastValence) > 0.2) {
        s.error = clamp(s.error + 0.4, 0, 1)
        s.adjusting = clamp(s.adjusting + P.adjustGain, 0, 1)
      }
      s.lastValence = val
      s.error *= decay(dt, P.errorTauMin)

      // A06 预期违背：上一拍形成过预期，这一拍没来
      if (s.expect && w.tx.cue !== s.expect) {
        s.expectAge += 1
        if (s.expectAge >= P.expectWindow) {
          s.surprise = clamp(s.surprise + 0.25, 0, 1)
          s.expect = null
          s.expectAge = 0
        }
      } else if (w.tx.cue === s.expect) {
        s.expect = null
        s.expectAge = 0
      }
      if (!s.expect && w.tx.cue && s.streakHint !== w.tx.cue) {
        s.expect = w.tx.cue
        s.expectAge = 0
      }
      s.streakHint = w.tx.cue
      s.surprise *= decay(dt, 20)

      // A07 自我监控：说得太长或太短，回头看自己一眼
      const len = f.len || 0
      s.monitor = clamp(Math.abs(len - 18) / 40, 0, 1)

      // A09 强迫：仪式被打断，还是接着来
      const broken = w.get('str')?.broken ?? 0
      const ritual = w.get('str')?.ritual ?? 0
      s.compulsion = clamp(s.compulsion + (broken > 0.2 && ritual > 0.2 ? 0.12 : -0.05), 0, 1)

      // A11 社会冲突：对方前后说的不一样
      const claim = f.praise ? 1 : f.cold ? -1 : null
      if (claim !== null && s.lastClaim !== null && claim !== s.lastClaim) {
        s.socialClash = clamp(s.socialClash + 0.3, 0, 1)
      }
      if (claim !== null) s.lastClaim = claim
      s.socialClash *= decay(dt, 60)

      // A12 承诺一致性：自己上一轮站过队，这一轮要改就疼
      if (w.tx.role === 'assistant' && s.commitment > 0.3) s.commitment = clamp(s.commitment - 0.1, 0, 1)
      else if (s.socialClash > 0.4) s.commitment = clamp(s.commitment + 0.15, 0, 1)

      // A05 疼痛的情绪成分：不是疼多少，是烦不烦
      s.pain = clamp((w.get('tpj')?.offense ?? 0) * 0.6 + s.error * 0.4, 0, 1)

      // A08 固执：冲突高就越不改；错误累积才松
      s.sticky = clamp(P.stickiness + 0.35 * s.conflict - 0.45 * s.error, 0.05, 0.95)
      // A04 努力成本
      s.effort = clamp(0.3 + P.effortGain * s.conflict + 0.35 * s.error, 0.05, 1)
      s.adjusting *= decay(dt, 20)
      s.frame += 1
    },

    read() {
      return {
        frame: s.frame,
        conflict: Number(s.conflict.toFixed(3)),
        error: Number(s.error.toFixed(3)),
        adjusting: Number(s.adjusting.toFixed(3)),
        sticky: Number(s.sticky.toFixed(3)),
        effort: Number(s.effort.toFixed(3)),
        surprise: Number(s.surprise.toFixed(3)),
        monitor: Number(s.monitor.toFixed(3)),
        compulsion: Number(s.compulsion.toFixed(3)),
        socialClash: Number(s.socialClash.toFixed(3)),
        commitment: Number(s.commitment.toFixed(3)),
        pain: Number(s.pain.toFixed(3)),
        conflicts: s.conflicts,
        reallocate: s.conflict > 0.55 || s.error > 0.5 || s.surprise > 0.4,
      }
    },

    snapshot: () => ({ ...s }),
    restore(o) { if (o) s = { ...fresh(), ...o } },
    health() { return { ok: true, frame: s.frame } },
  }
}
