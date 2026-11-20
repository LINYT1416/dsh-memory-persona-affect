// 神经内分泌：皮质醇 / 催产素 / 雌激素 / 睾酮 / 甲状腺。覆盖 E01-E05。
// 大多由下丘脑驱动，这里做慢速整合与个体差异。
//
// 这一版修的是"数在、反应不在"：
//   E01 以前用一条 90 分钟的自有曲线，跟 H06 的 HPA（8 分钟升 / 70 分钟退）对不上，
//       一场十几分钟的压力里皮质醇几乎不动。现在同一根轴、同一组时间常数。
//   E02 以前目标恒等于 trust*0.6＝0.36，而初值就是 0.35 —— 它一辈子只在 0.35~0.36 之间。
//       现在亲密（被抱、被谢、被信任）才把它抬起来，而它反过来降低敌意归因的门槛（T05）。
//   E03 以前相位只是三个台阶（0.3 / 0.6 / 0.35），没有"经前波动"这回事。
//       现在有一条日间起伏，经前一周幅度 ×1.3。
//   E04 以前只看 threat>0.5，而"竞争失败"根本不是威胁，是一句"你输了/你比不过他"。
//   E05 以前目标恒等于自己的初值 0.6，等于没有这条通道。现在它慢慢跟"长期低能量"。

import { clamp, decay } from '../core/consts.js'

const P = {
  cortTauUp: 8, cortTauDown: 70,   // E01 = H06：8 分钟升、70 分钟退
  oxyTau: 25,                      // E02 亲密激素：几十分钟量级
  testoTau: 180,                   // E04 睾酮恢复：小时量级
  thyroidTau: 360,                 // E05 长期低能量：6 小时量级（"长期"就得慢）
}

// E04 竞争失败的线索：输、被比下去、被淘汰。不是"被骂"，是"输了"。
const DEFEAT = /输了|输给|比不过|不如他|被淘汰|垫底|落选|倒数|没赢|败了|被比下去|比我强|你不行|你做不到|你没戏/
const WIN = /赢了|比过他|赢过他|拿了第一|被表扬|被夸|真厉害|你最牛/
// E02 亲密线索
const INTIMATE = /抱|亲|喜欢|爱你|谢谢|陪我|想你|懂我|别怕|我在|辛苦/
// E03 周期长度（和 H15 一致）
const CYCLE_LEN = 28

export function create() {
  const fresh = () => ({
    cortisol: 0.15, oxytocin: 0.35, estrogen: 0.5, testosterone: 0.5, thyroid: 0.6,
    status0: 0.5, frame: 0,
  })
  let s = fresh()

  return {
    id: 'endocrine',
    cover: ['E01', 'E02', 'E03', 'E04', 'E05'],
    step(w) {
      const dt = clamp(Number(w.tx?.dtMs) || 60_000, 0, 24 * 3600_000)
      const min = dt / 60_000
      const hyp = w.get('hypothalamus')
      const soc = w.get('social')
      const sick = w.get('sickness') || {}
      const events = Array.isArray(w.tx?.events) ? w.tx.events : []
      const said = events.filter(e => e?.type === 'user').map(e => String(e.text || '')).join(' ')

      // E01 皮质醇：同一根 HPA 轴。升快退慢（8/70，与 H06 一致），只是它读的是下丘脑算出来的 hpa，
      // 不再自己另起一条 90 分钟的曲线 —— 那样一场十几分钟的压力里它几乎不动。
      const hpaC = clamp(Number(hyp?.hpa?.cortisol ?? 0.15), 0, 1)
      const kC = hpaC > s.cortisol
        ? 1 - Math.exp(-min / P.cortTauUp)
        : 1 - Math.exp(-min / P.cortTauDown)
      s.cortisol = clamp(s.cortisol + (hpaC - s.cortisol) * kC, 0, 1)

      // E02 催产素：亲密与信任把它抬起来，被晾着会压下去。它再回去降"把中性话读成敌意"的门槛（T05）
      const comfort = clamp(Number(soc?.comfort ?? 0), 0, 1)
      const trust = clamp(Number(soc?.trust ?? 0.6), 0, 1)
      const pain = clamp(Number(soc?.socialPain ?? 0), 0, 1)
      const intimate = INTIMATE.test(said) ? 1 : 0
      const oxyTarget = clamp(0.10 + 0.42 * trust + 0.30 * comfort + 0.20 * intimate - 0.12 * pain, 0, 1)
      s.oxytocin = clamp(s.oxytocin + (oxyTarget - s.oxytocin) * (1 - decay(dt, P.oxyTau)), 0, 1)

      // E03 雌激素：周期相位定基调 + 一条日间起伏。
      // 经前一周的起伏幅度 ×1.3 —— 不是把整条线抬起来，是"这一段更晃"。
      const cyc = hyp?.cycle ?? { on: false, day: 14 }
      if (cyc.on) {
        const day = clamp(Number(cyc.day) || 14, 1, CYCLE_LEN)
        const period = day <= 5
        const pre = day > CYCLE_LEN - 7           // 最后一周：经前
        const base = period ? 0.30 : pre ? 0.35 : 0.60
        // 经前一周幅度 ×1.3；经期本身是低的、几乎不晃
        const amp = period ? 0.03 : pre ? 0.10 * 1.3 : 0.10
        // 7 天一周期的日间起伏：任何 3~4 天窗口里都能量到峰谷差 = 2*amp
        const swing = amp * Math.sin((day / 7) * 2 * Math.PI)
        s.estrogen = clamp(base + swing, 0.1, 1)
      } else {
        s.estrogen = 0.5
      }

      // E04 睾酮：竞争失败（输了/被比下去/地位掉了）往下走，赢了往上一点；恢复是小时量级。
      const status = clamp(Number(soc?.status ?? 0.5), 0, 1)
      const statusDrop = clamp(Number(s.status0 ?? status) - status, 0, 1)
      const defeated = DEFEAT.test(said) || statusDrop > 0.005
      const won = !defeated && WIN.test(said)
      if (defeated) s.testosterone = clamp(s.testosterone - 0.06, 0, 1)
      else if (won) s.testosterone = clamp(s.testosterone + 0.03, 0, 1)
      s.testosterone = clamp(s.testosterone + (0.5 - s.testosterone) * (1 - decay(dt, P.testoTau)), 0, 1)
      s.status0 = status

      // E05 甲状腺：简化成"长期低能量"标量 —— 病感、缺觉、慢性压力慢慢把它压下去，6 小时量级，
      // 所以一条消息不会动它，生病熬一下午才会。
      const inflam = clamp(Number(sick.inflammation ?? 0), 0, 1)
      const sleepDebt = clamp(Number(hyp?.sleepDebt ?? 0.15), 0, 1)
      const chronic = clamp(
        0.55 * inflam + 0.35 * sleepDebt + 0.75 * clamp((s.cortisol - 0.2) / 0.5, 0, 1),
        0, 1,
      )
      const thyTarget = clamp(0.75 - 0.55 * chronic, 0.2, 0.95)
      s.thyroid = clamp(s.thyroid + (thyTarget - s.thyroid) * (1 - decay(dt, P.thyroidTau)), 0, 1)

      s.frame += 1
    },
    read() {
      return {
        frame: s.frame,
        cortisol: s.cortisol, oxytocin: s.oxytocin, estrogen: s.estrogen,
        testosterone: s.testosterone, thyroid: s.thyroid,
      }
    },
    snapshot: () => ({ ...s }),
    restore(o) { if (o) s = { ...fresh(), ...o } },
    health: () => ({ ok: true, degraded: false, frame: s.frame }),
  }
}
