// 输入偏置：心情差只看见坏的 / 敌意归因 / 心境一致。
// 覆盖 O01 O02 O03。作用在"解读"上，不是"表达"上。
//
// 这一版修的是"偏置量跟这句话没关系"：
//   O01 以前 neg 只跟 mood、调质走，威胁放大那条路倒是通着（fuse 的 appraisalOf 用 1+0.3*neg），
//       所以"心情差时同一句话读得更冲"是能验的 —— 这里把它写清楚，别再把 neg 当成死数。
//   O02 以前 hostile = (1-trust)*0.5 + 0.4*(threat>0.5)：一句"随便吧。"能不能被判成挑衅，
//       完全取决于信任分，跟"这句话什么味儿"无关。现在中性但带刺的形态（冷字、阴阳、敷衍）直接算进去，
//       而被抱过、被谢过（E02 催产素高）会把这条门槛降下来（T05）。
//   O03 心境一致性：心情偏哪边，记忆检索就往哪边偏；congruent 就是这个偏置量（M08 用它做重排的旁证）。

import { clamp } from '../core/consts.js'

// 冷处理：整句就是这几个字（"随便吧。""算了。" 都算）
const COLD_ONLY = /^(哦|嗯|随便|都行|算了|行吧|知道了|随你|那行)(吧|了|啦)?[。.!！~～\s]*$/
// 阴阳/敷衍：字面不脏，但听得出来不客气
const NEEDLE = /呵呵|随你|你开心就好|关我什么事|爱咋咋|你看着办|不服|你懂什么|就这|行吧你/
// 明确带刺
const NEG_CUE = /烦|讨厌|滚|闭嘴|不行|没用|废物|算了|无语|失望|恶心|傻|蠢/

export function create() {
  const fresh = () => ({ neg: 0, hostile: 0, congruent: 0, frame: 0 })
  let s = fresh()

  return {
    id: 'bias',
    cover: ['O01', 'O02', 'O03'],
    step(w) {
      const mood = Number(w.mood ?? 0)
      const amy = w.get('amygdala')
      const soc = w.get('social')
      const hip = w.get('hippocampus')
      const nmod = w.get('neuromod')
      const endo = w.get('endocrine')
      const events = Array.isArray(w.tx?.events) ? w.tx.events : []
      const said = events.filter(e => e?.type === 'user').map(e => String(e.text || '')).join(' ').trim()

      // O01 负性偏置：心情越低，越容易把中性读成负面。
      // 它不是一个"记下来的心情"，它会去放大威胁（fuse.appraisalOf: threat × (1 + 0.3*neg)）。
      s.neg = clamp(-mood * 0.6 + 0.2 * (nmod?.ne ?? 0.3), 0, 1)

      // O02 敌意归因：信任低 + 被这个人伤过（M12 社会记忆）+ 这句话的形态（冷/阴阳/带刺）
      const hurts = hip?.persons?.他?.hurts ?? 0
      const trust = clamp(Number(soc?.trust ?? 0.6), 0, 1)
      // T05/E02：亲密激素高时，"把中性话读成敌意"的门槛低——不轻易往坏处想
      const oxy = clamp(Number(endo?.oxytocin ?? 0.35), 0, 1)
      const coldCue = COLD_ONLY.test(said)
      const needleCue = NEEDLE.test(said)
      const negCue = NEG_CUE.test(said)
      s.hostile = clamp(
        (1 - trust) * 0.5
        + 0.4 * ((amy?.threat ?? 0) > 0.5 ? 1 : 0)
        + 0.05 * hurts
        + (coldCue ? 0.50 : 0)
        + (needleCue ? 0.22 : 0)
        + (negCue ? 0.12 : 0)
        // O01：心情差的时候同一句话会被读得更带刺（解读不同，不是表达不同）
        + 0.25 * s.neg
        - 0.25 * oxy,
        0, 1,
      )

      // O03 心境一致性：记忆检索的偏置量（心情偏哪边，往哪边偏得更多）
      s.congruent = clamp(Math.abs(mood) + 0.2 * Math.max(0, -mood), 0, 1)
      s.frame += 1
    },
    read() {
      return { frame: s.frame, neg: s.neg, hostile: s.hostile, congruent: s.congruent }
    },
    snapshot: () => ({ ...s }),
    restore(o) { if (o) s = { ...fresh(), ...o } },
    health: () => ({ ok: true, degraded: false, frame: s.frame }),
  }
}
