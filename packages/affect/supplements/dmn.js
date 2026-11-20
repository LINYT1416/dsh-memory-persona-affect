// 默认模式网络：走神、自我参照、反刍、心理时间、社交想象。覆盖 D01-D05。
//
// 修的两处：
//   · D01 走神原来只靠"这拍有没有 tick 累计的空闲"，实测里 tick 稀疏时几乎永远攒不够；
//     门槛又写的是 `> 600_000`（正好 10 分钟差一秒），且没有单拍上限。
//     现在空闲取「累计」和「距上一条消息多久」的较大者，门槛按 >= 10 分钟，
//     每拍最多 +0.2（关机补算那种一拍跨几小时的情况不会一下冲到满屏走神）。
//   · selfThought 是个纯静态函数，felt 一漂它就跟着跳（rate-audit 里两分钟跳 0.08）；
//     改成朝目标值按 10 分钟量级收敛，跟其它慢变量一个手感。

import { clamp, decay } from '../core/consts.js'

export function create(cfg = {}) {
  const P = {
    wanderAfterMs: 600_000, // 10 分钟没人说话 → 开始走神
    wanderRise: 0.1,        // 每分钟涨多少
    wanderFall: 0.2,        // 有人说话时每分钟落多少
    wanderStepCap: 0.2,     // 单拍最多涨多少（关机补算不炸）
    tauSelf: 10,            // 自我参照收敛时间常数
  }
  const p = { ...P, ...cfg }

  const fresh = () => ({ mindWander: 0, selfThought: 0.2, rumination: 0, mentalTime: 0.3, socialImagining: 0.2, idleMs: 0, frame: 0, anchors: 0, chapters: 0 })
  let s = fresh()

  return {
    id: 'dmn',
    cover: ['D01', 'D02', 'D03', 'D04', 'D05'],
    step(w) {
      const dt = w.tx.dtMs
      const amy = w.get('amygdala')
      const ins = w.get('insula')
      const talking = w.tx.events.some(e => e.type === 'user')
      s.idleMs = talking ? 0 : s.idleMs + dt
      // 真正的"没人说话多久"：tick 稀疏的时候累计值追不上墙钟，取大的那个
      const quietMs = Math.max(s.idleMs, talking ? 0 : Number(w.gapMs ?? 0))

      // 自我参照/反刍不能凭空：拿真实记忆当锚点，记忆没接上就老实是空
      const echo = w.memoryEcho
      const recent = Array.isArray(w.memoryRecent) ? w.memoryRecent : []
      const memHits = Array.isArray(echo?.hits) ? echo.hits.length : 0
      const memTone = Number(echo?.tone ?? 0)
      s.anchors = memHits
      s.chapters = recent.length

      // D01 走神：没人说话 10 分钟后开始
      if (quietMs >= p.wanderAfterMs) {
        const rise = Math.min(p.wanderStepCap, p.wanderRise * (dt / 60_000))
        s.mindWander = clamp(s.mindWander + rise, 0, 1)
      } else {
        s.mindWander = clamp(s.mindWander - p.wanderFall * (dt / 60_000), 0, 1)
      }

      // D02 自我参照：走神 + 体感 + 想起旧事，都会把人拉回自己身上（慢变量，收敛着走）
      const selfTarget = clamp(0.2 + 0.4 * s.mindWander + 0.3 * (ins?.felt.intensity ?? 0) + 0.2 * Math.min(1, memHits / 3), 0, 1)
      s.selfThought = clamp(s.selfThought + (selfTarget - s.selfThought) * (1 - Math.exp(-(dt / 60_000) / p.tauSelf)), 0, 1)

      // D03 反刍：负性事件后反复；想起的旧事是负的，也会启动
      const neg = (amy?.threat ?? 0) > 0.3 || (memHits > 0 && memTone < -0.15)
      // 想起负性旧事的那一拍就要起作用，不能等下一分钟的时间积分
      if (neg && !s.lastNegMem) s.rumination = clamp(s.rumination + 0.15, 0, 1)
      s.lastNegMem = neg
      // 反刍按 30 分钟量级退，而且负性事件之后会自己再续一阵（反复出现，不是一次性）
      const echoNeg = s.rumination > 0.05
      s.rumination = clamp(s.rumination * decay(dt, 30) + ((neg || echoNeg) ? 0.02 : -0.008) * (dt / 60_000), 0, 1)
      // D04 心理时间
      // 心理时间：想"明天/上次"这件事平时也在走，负性/反刍时走得更快
      s.mentalTime = clamp(s.mentalTime + ((neg || s.rumination > 0.05) ? 0.05 : 0.01) * (dt / 60_000), 0, 1)
      // D05 社交想象
      s.socialImagining = clamp(
        s.socialImagining * decay(dt, 60) + (quietMs >= 300_000 ? 0.05 * Math.min(3, dt / 300_000) : 0), 0, 1,
      )
      s.frame += 1
    },
    read() {
      return { frame: s.frame, mindWander: s.mindWander, selfThought: s.selfThought, rumination: s.rumination, mentalTime: s.mentalTime, socialImagining: s.socialImagining, idleMs: s.idleMs, anchors: s.anchors, chapters: s.chapters }
    },
    snapshot: () => ({ ...s }),
    restore(o) { if (o) s = { ...fresh(), ...o } },
    health: () => ({ ok: true, degraded: false, frame: s.frame }),
  }
}
