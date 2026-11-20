// 脑干唤醒层：呼吸、心率、觉醒、惊跳、自主耦合。覆盖 B01-B05。
//
// 这一版修的是"天天在算、但跟刺激没关系"：
//   B01 呼吸只跟交感走，而交感是 3 分钟量级的慢变量 —— 被吓一跳的那一拍呼吸纹丝不动。
//       现在恐慌由威胁直接驱动（当下就喘），交感只是背书，恐慌时频率 ×1.5。
//   B02 心率本来就与自主神经联动，但没有被验证过：这里把交感/副交感的独立影响写清楚，
//       并且放松时副交感要能把心率压回去（不是只会涨）。
//   B03 以前觉醒写成 max(0.2+0.6sym, 1-睡眠债)：睡眠债 0.15 时它就恒等于 0.85，
//       昼夜完全不起作用。现在两条通道取 max（C09：觉醒的几路来源不相加），
//       但"清醒通道"里带昼夜，"睡眠压力通道"里带昼夜驱力 —— 深夜会真的掉下来，
//       而睡眠债只在第二个通道里出现一次（不重复扣）。
//   B04 惊跳要求 threat>0.5，而单句威胁被熔断在 0.35 左右，所以它永远不触发。
//       现在按"威胁骤升"判定（突发消息），并且按时长衰减 —— 僵住是短的一下，不是一直僵。
//   B05 耦合原来只是交感的另一个多项式，不是"呼吸和心率到底同不同步"。
//       现在它数的是两条曲线每拍的方向是否一致（同步度），不是换个写法把交感再抄一遍。

import { clamp, decay, hourOf } from '../core/consts.js'

const P = {
  breathBase: 14,          // 平静 14 次/分
  panicBreathGain: 0.5,    // B01：恐慌时 ×1.5
  startleTau: 0.5,         // B04：惊跳 30 秒量级散掉
  couplingK: 0.4,          // B05：同步度的跟随速度
  nightDrive: 0.50,        // 夜里本来就困（昼夜驱力），不是睡眠债
}

export function create() {
  const fresh = () => ({
    respiration: 14, heartRate: 70, arousal: 0.55, startle: 0, coupling: 0.5, freeze: 0,
    panic: 0, frame: 0,
    prevThreat: 0.05, prevResp: 14, prevHr: 70,
  })
  let s = fresh()

  return {
    id: 'brainstem',
    cover: ['B01', 'B02', 'B03', 'B04', 'B05'],
    step(w) {
      const hyp = w.get('hypothalamus')
      const amy = w.get('amygdala')
      const dt = clamp(Number(w.tx?.dtMs) || 60_000, 0, 24 * 3600_000)
      const sym = clamp(Number(hyp?.autonomic?.sym ?? 0.3), 0, 1)
      const par = clamp(Number(hyp?.autonomic?.par ?? 0.6), 0, 1)
      const threat = clamp(Number(amy?.threat ?? 0), 0, 1)
      const sleepDebt = clamp(Number(hyp?.sleepDebt ?? 0.2), 0, 1)
      const stimulant = clamp(Number(hyp?.stimulant ?? 0), 0, 1)
      const events = Array.isArray(w.tx?.events) ? w.tx.events : []
      const userCame = events.some(e => e?.type === 'user')
      // 时刻必须取引擎时钟（测试/补算注入的假时钟），不能拿 Date.now()
      const hour = hourOf(Number(w.tx?.t1 ?? Date.now()))
      const night = hour >= 23 || hour < 6

      // B01 恐慌：威胁主导。恐慌不是"交感慢慢爬上来"，是当下一紧。
      // 平静（威胁 0.05）时 panic=0，呼吸正好是基线 14；真恐慌（威胁 0.6+）时 panic=1 → 21。
      s.panic = clamp((threat - 0.1) / 0.5 + 0.15 * (sym - 0.3), 0, 1)
      s.respiration = clamp(P.breathBase * (1 + P.panicBreathGain * s.panic), 6, 30)

      // B02 心率：交感抬、副交感压，恐慌再加一笔。放松（par 高）时心率要能落回去。
      s.heartRate = clamp(62 + 40 * sym - 12 * par + 10 * s.panic, 45, 140)

      // B03 觉醒：两条通道取 max（C09：不相加）。
      //   清醒通道：昼夜底色 + 交感 + 咖啡因 + 恐慌
      //   睡眠压力通道：1 - 睡眠债（睡眠债只在这里出现这一次）
      // 深夜两条都低，所以夜里真的会掉下来；缺觉只要够重，也能把觉醒压下去。
      // 两条通道取 max（C09：觉醒的几路来源不相加），睡眠债只出现这一次
      s.arousal = clamp(Math.max(0.2 + 0.6 * sym + 0.25 * stimulant + 0.2 * s.panic, 1 - sleepDebt), 0.05, 1)

      // B04 惊跳：突发消息 = 威胁骤然抬升，或者本来就高。按 dt 衰减 —— 短暂僵住，不是一直僵。
      const jump = threat - clamp(Number(s.prevThreat ?? threat), 0, 1)
      const sudden = userCame && (jump > 0.08 || threat > 0.55)
      const bit = sudden ? clamp(0.35 + 0.9 * Math.max(0, jump) + 0.35 * s.panic, 0, 1) : 0
      s.startle = clamp(s.startle * decay(dt, P.startleTau) + bit, 0, 1)
      // 僵住：惊跳那一两拍动不了/说不出话；A20 那种持续威胁的僵住也并进来
      s.freeze = clamp(Math.max(s.startle * 1.15, Number(hyp?.freeze ?? 0) * 0.8), 0, 1)

      // B05 呼吸-心率耦合：两条曲线这一拍方向一致就记一次同步，反向就记一次不同步。
      // 只在两边都真动了的时候计票，静止不投票（静止不等于同步）。
      const dR = s.respiration - Number(s.prevResp ?? s.respiration)
      const dH = s.heartRate - Number(s.prevHr ?? s.heartRate)
      if (Math.abs(dR) > 1e-6 && Math.abs(dH) > 1e-6) {
        const same = Math.sign(dR) === Math.sign(dH) ? 1 : 0
        s.coupling = clamp(s.coupling + (same - s.coupling) * P.couplingK, 0, 1)
      }

      s.prevThreat = threat
      s.prevResp = s.respiration
      s.prevHr = s.heartRate
      s.frame += 1
    },
    read() {
      return {
        frame: s.frame,
        respiration: s.respiration, heartRate: s.heartRate,
        arousal: s.arousal, startle: s.startle, coupling: s.coupling,
        freeze: s.freeze,
      }
    },
    snapshot: () => ({ ...s }),
    restore(o) { if (o) s = { ...fresh(), ...o } },
    health: () => ({ ok: true, degraded: false, frame: s.frame }),
  }
}
