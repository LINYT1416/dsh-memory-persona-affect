// 颞顶联合：心智化。十一条都要真跑，允许读错。

import { clamp, decay, smellsOff } from '../core/consts.js'

const DEFAULTS = {
  intentBias: 0.5,
  offenseBase: 0.45,
  airSense: 0.5,
  deceptionGain: 0.4,
}

const SCRIPT = [
  { re: /^(早|早上好|早安)/, key: 'greet' },
  { re: /^(晚安|睡了)/, key: 'night' },
  { re: /(谢谢|谢了|多谢)/, key: 'thanks' },
  { re: /(对不起|抱歉)/, key: 'sorry' },
  { re: /^(在吗|在么)/, key: 'ping' },
]

export function create(cfg = {}) {
  const P = { ...DEFAULTS, ...cfg }
  const fresh = () => ({
    intent: 0.5, offense: 0, air: 0.5, role: 'close',
    misread: 0, lastRead: '', frame: 0,
    belief: 0, empathy: 0.5, script: '', ingroup: 0, deception: 0,
    reads: 0, correct: 0,
  })
  let s = fresh()

  return {
    id: 'tpj',
    cover: ['T01', 'T02', 'T03', 'T04', 'T05', 'T06', 'T07', 'T08', 'T09', 'T10', 'T11'],
    params: P,

    step(w) {
      const f = w.tx.f
      const text = String(w.tx.text || '')
      const off = smellsOff(text)

      // T01 意图推断
      const deliberate = clamp(P.intentBias + 0.35 * off + 0.15 * f.exclaim - 0.25 * f.warm, 0, 1)
      s.reads += 1
      if (deliberate > 0.65 && f.warm) {
        s.misread = clamp(s.misread + 0.3, 0, 1)
        s.correct = Math.max(0, s.correct - 1)   // 读错了，扣一次
      } else if (deliberate < 0.35 && f.cold) {
        s.misread = clamp(s.misread + 0.15, 0, 1)
      } else if (deliberate > 0.65 || deliberate < 0.35) {
        s.correct += 1
      }
      // 其余是"读不准"：不记对也不记错——以前这里被算成了读对，共情精度永远是 1
      s.intent = deliberate
      s.lastRead = deliberate > 0.65 ? 'deliberate' : deliberate < 0.35 ? 'kind' : 'unclear'

      // T02 信念归因：他在猜她在想什么
      s.belief = clamp((/以为|觉得我|你是不是想|你是不是觉得/.test(text) ? 0.7 : 0) + s.belief * 0.6, 0, 1)

      // T04 被冒犯
      s.offense = clamp((f.cold * 0.5 + off * 0.45 + f.command * 0.2) - P.offenseBase * 0.5, 0, 1)

      // T05 读空气
      const serious = f.complaint || (f.question && !f.warm)
      s.air = clamp((serious ? 0.25 : P.airSense) + 0.15 * (f.warm ? 1 : 0) - 0.1 * (f.sarcasm ? 1 : 0), 0, 1)

      // T06 共情精度：读对的比率，不是一次成败
      // 样本不足 2 次不给结论：否则初始就是 1.0，注入里会一直说"我懂他"
      // 精度 = 读对 /（读对 + 读错）；没有证据就是 0.5，不吹"我很懂他"
      const judged = s.correct + s.misread
      s.empathy = judged > 0.01 ? clamp(s.correct / judged, 0, 1) : 0.5

      // T08 社交脚本：认得出客套
      s.script = SCRIPT.find((x) => x.re.test(text))?.key || ''

      // T09 群体归属："我们"就是自己人
      s.ingroup = clamp(/我们|咱|自己人|一起/.test(text) ? 0.8 : s.ingroup * 0.7, 0, 1)

      // T10 欺骗检测：说得前后打架，或者嘴上和话里对不上
      const clash = w.get('acc')?.socialClash ?? 0
      s.deception = clamp(s.deception * decay(w.tx.dtMs, 120) + (clash > 0.25 ? P.deceptionGain : 0), 0, 1)

      // T11 角色切换
      s.role = w.relationship || 'close'

      s.misread = clamp(s.misread * decay(w.tx.dtMs, 180), 0, 1)
      s.frame += 1
    },

    read() {
      return {
        frame: s.frame,
        intent: Number(s.intent.toFixed(3)),
        reading: s.lastRead,
        belief: Number(s.belief.toFixed(3)),
        offense: Number(s.offense.toFixed(3)),
        air: Number(s.air.toFixed(3)),
        role: s.role,
        misread: Number(s.misread.toFixed(3)),
        empathy: Number(s.empathy.toFixed(3)),
        script: s.script,
        ingroup: Number(s.ingroup.toFixed(3)),
        deception: Number(s.deception.toFixed(3)),
        blunt: Number(clamp(0.35 + 0.5 * s.offense - 0.2 * s.air, 0, 1).toFixed(3)),
      }
    },

    snapshot: () => ({ ...s }),
    restore(o) { if (o) s = { ...fresh(), ...o } },
    health() { return { ok: true, frame: s.frame, empathy: s.reads ? Number((s.correct / s.reads).toFixed(2)) : null } },
  }
}
