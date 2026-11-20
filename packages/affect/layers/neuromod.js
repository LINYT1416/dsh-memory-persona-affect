// 调质层：蓝斑 / 中脑 / 中缝 / 基底前脑 / 垂体。覆盖 T01-T08。
// 全局增益，不做局部判断；局部模块先算，再乘这里（顺序见 C10）。
//
// 这一版补的是"只有输入、没有出口"的几条：
//   · T03：原来只有 serotonin 这个读数，没有"冲动"这个量，谁也读不到它；
//     现在 serotonin 低 → impulsivity 高，海马体的检索门跟着松（冲动＝不那么审慎）。
//   · T05：催产素只有激素值，没有"信任门槛"；现在亲密度（oxytocin）直接压门槛，
//     海马体用它决定这条暖事算不算"亲近到可以记住"。
//   · T01/T06：NE 下调海马写入门槛；被踩到雷区时加压素额外抬一档。

import { clamp, decay } from '../core/consts.js'

const P = {
  tauNe: 40, tauDa: 25, tau5ht: 180, tauAch: 60,
  tauVaso: 90, tauOpioid: 60, tauEndo: 120,
  trustBase: 0.62,     // T05 信任门槛的起点
  trustDrop: 0.55,     // T05 亲密（oxytocin 高于 0.35 的部分）按这个比例压门槛
}

export function create(cfg = {}) {
  const p = { ...P, ...cfg }
  const fresh = () => ({
    ne: 0.3, da: 0.5, serotonin: 0.5, ach: 0.4,
    oxytocin: 0.35, vasopressin: 0.3, opioid: 0.3, endocannabinoid: 0.2,
    frame: 0,
  })
  let s = fresh()

  return {
    id: 'neuromod',
    cover: ['T01', 'T02', 'T03', 'T04', 'T05', 'T06', 'T07', 'T08'],
    params: p,
    step(w) {
      const dt = clamp(Number(w.tx?.dtMs ?? 0), 0, 24 * 3600_000)
      const amy = w.get('amygdala')
      const hyp = w.get('hypothalamus')
      const soc = w.get('social')
      const att = w.get('attention')
      const hip = w.get('hippocampus')
      const threat = clamp(Number(amy?.threat ?? 0), 0, 1)
      const reward = clamp(Number(amy?.rewardPE ?? 0), -1, 1)
      const h = clamp(dt / 3600_000, 0, 24)
      // 海马体上一帧留下的两个信号：踩到雷区、以及"还没发生"的担忧
      const landmine = hip?.landmine ?? null
      const worry = hip?.recall?.worry ?? null
      // 记下的雷区越多，警戒底噪越高（同一个威胁更容易把人点着）
      const knownMines = Array.isArray(hip?.persons?.['他']?.landmines) ? Math.min(3, hip.persons['他'].landmines.length) : 0

      // T01 NE：威胁抬升，蓝斑；脑子里打转的担忧也拉一点
      s.ne = clamp(s.ne * decay(dt, p.tauNe) + 0.5 * threat + 0.1 * clamp(Number(hyp?.stimulant ?? 0), 0, 1) + (worry ? 0.04 : 0) + 0.02 * knownMines * threat, 0, 1)
      // T02 DA：奖赏预测误差；落空时低于基线（0.5）
      s.da = clamp(0.5 + 0.5 * reward * (1 - 0.3 * s.ne), 0, 1)
      // T03 5-HT：威胁多、奖赏少 → 血清素被压；低 5-HT 不等于"难过"，是"压不住"
      const pull = 1 - decay(dt, p.tau5ht)
      s.serotonin = clamp(
        s.serotonin + (0.5 - s.serotonin) * pull
        - 0.14 * Math.max(0, threat - 0.4) * (1 - decay(dt, 20))
        + 0.02 * (reward > 0 ? 1 : 0) * (1 - decay(dt, 20)),
        0, 1,
      )
      // T04 ACh：注意集中时上升
      const focus = clamp(Number(att?.focus ?? 0.3), 0, 1)
      s.ach = clamp(s.ach + (0.4 + 0.3 * focus - s.ach) * 0.1 * Math.min(1, h * 3 + 0.2), 0, 1)
      // T05 催产素：亲密互动（激素给量，往激素值收敛）
      s.oxytocin = clamp(s.oxytocin + ((hyp?.hormones?.oxytocin ?? 0.3) - s.oxytocin) * 0.1 * Math.min(1, h * 2 + 0.1), 0, 1)
      // T06 加压素：被冒犯 → 攻击性；踩到雷区额外一档
      s.vasopressin = clamp(
        s.vasopressin * decay(dt, p.tauVaso)
        + 0.4 * threat * clamp(Number(hyp?.aggression ?? 0.1), 0, 1)
        + (landmine ? 0.12 : 0),
        0, 1,
      )
      // T07 阿片：被安抚
      s.opioid = clamp(s.opioid * decay(dt, p.tauOpioid) + 0.3 * clamp(Number(soc?.comfort ?? 0), 0, 1), 0, 1)
      // T08 内源性大麻素：运动后
      s.endocannabinoid = clamp(s.endocannabinoid * decay(dt, p.tauEndo) + (w.activity === 'sport' ? 0.3 : 0), 0, 1)
      s.frame += 1
    },
    read() {
      // T03 冲动：低 5-HT → 压不住（0.5 → 0.25；0.25 → 0.5）
      const impulsivity = clamp(0.75 - 1.0 * s.serotonin, 0, 1)
      // T05 信任门槛：亲密之后门槛下来（0.35 → 0.62；0.8 → 0.37）
      const trustThreshold = clamp(p.trustBase - p.trustDrop * Math.max(0, s.oxytocin - 0.35), 0.25, 0.75)
      return {
        frame: s.frame,
        ne: s.ne, da: s.da, serotonin: s.serotonin, ach: s.ach,
        oxytocin: s.oxytocin, vasopressin: s.vasopressin, opioid: s.opioid, endocannabinoid: s.endocannabinoid,
        impulsivity,
        trustThreshold,
        // 全局增益：高 NE 时所有阈值下调
        gain: clamp(1 + 0.4 * (s.ne - 0.3) - 0.2 * (s.serotonin - 0.5), 0.5, 1.8),
      }
    },
    snapshot: () => ({ ...s }),
    restore(o) { if (o) s = { ...fresh(), ...o } },
    health: () => ({ ok: true, degraded: false, frame: s.frame }),
  }
}
