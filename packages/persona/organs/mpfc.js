// 内侧前额叶：自我参照。十二条都要真跑。

import { clamp, decay } from '../core/consts.js'

const DEFAULTS = {
  selfWeight: 0.75,
  esteemRate: 0.16,
  esteemBase: 0.5,
  ideal: 0.8,
  boundary: 0.5,
  protectGain: 0.55,
  reappraiseCost: 0.15,
}

const ADJ = [
  { re: /可爱|好看|漂亮|可爱/, key: '好看' },
  { re: /厉害|牛|棒|强/, key: '厉害' },
  { re: /笨|傻|蠢|不行/, key: '不行' },
  { re: /烦|吵|啰嗦/, key: '烦人' },
  { re: /温柔|贴心|暖/, key: '温柔' },
]

export function create(cfg = {}) {
  const P = { ...DEFAULTS, ...cfg }
  const fresh = () => ({
    relevance: 0.3, esteem: P.esteemBase, boundary: P.boundary,
    protecting: 0, calm: 0, hits: [], frame: 0,
    selfWords: {}, idealGap: 0, discomfort: 0, presentation: 0.5, blameSelf: 0.5,
  })
  let s = fresh()

  return {
    id: 'mpfc',
    cover: ['M01', 'M02', 'M03', 'M04', 'M05', 'M06', 'M07', 'M08', 'M09', 'M10', 'M11', 'M12'],
    params: P,

    step(w) {
      const dt = w.tx.dtMs
      const f = w.tx.f
      const text = String(w.tx.text || '')

      // M01 自我参照加权
      s.relevance = clamp(P.selfWeight * (0.25 + 0.45 * f.selfRef + 0.2 * (f.praise || f.complaint)), 0, 1)

      // M02 自我概念：别人怎么形容她，记下来
      if (f.selfRef || f.otherRef) {
        for (const a of ADJ) {
          if (a.re.test(text)) s.selfWords[a.key] = (s.selfWords[a.key] || 0) + 1
        }
      }

      // M03 自尊
      const up = 0.12 * f.praise + 0.06 * f.warm
      const down = 0.16 * f.cold + 0.10 * f.command + 0.08 * f.sarcasm
      s.esteem = clamp(s.esteem + P.esteemRate * (up - down), 0, 1)
      s.esteem = clamp(s.esteem + (P.esteemBase - s.esteem) * 0.02, 0, 1)

      // M04 理想我—现实我差距
      s.idealGap = clamp(Math.abs(P.ideal - s.esteem), 0, 1)

      // M09 一致性审查：自我概念是"厉害"的人，做软事就别扭
      const good = (s.selfWords['厉害'] || 0) + (s.selfWords['好看'] || 0)
      const bad = (s.selfWords['不行'] || 0) + (s.selfWords['烦人'] || 0)
      const selfImage = clamp((good - bad) / Math.max(1, good + bad), -1, 1)
      const actingSoft = f.warm && s.protecting < 0.2
      s.discomfort = clamp(Math.abs(selfImage) * (actingSoft ? 0.5 : 0.2) + s.idealGap * 0.3, 0, 1)

      // M06 护短
      const attacked = f.cold && f.otherRef
      s.protecting = clamp(attacked ? s.protecting + P.protectGain : s.protecting * decay(dt, 45), 0, 1)

      // M07 被戳的点
      const poked = (1 - s.esteem) * (f.otherRef ? 1 : 0.4) * (f.cold || f.sarcasm ? 1 : 0)
      if (poked > 0.4) s.hits.push({ at: w.tx.t1, poked: Number(poked.toFixed(2)) })
      if (s.hits.length > 8) s.hits.shift()

      // M08 重评
      const conflict = w.get('acc')?.conflict ?? 0
      if (conflict > 0.45 && s.esteem > 0.35 && s.calm < 0.6) {
        s.calm = clamp(s.calm + 0.25 - P.reappraiseCost, 0, 1)
      }
      s.calm = clamp(s.calm * decay(dt, 30), 0, 1)

      // M05 边界
      const rel = w.relationship || 'close'
      const target = rel === 'stranger' ? 0.8 : rel === 'close' ? 0.4 : 0.6
      s.boundary = clamp(s.boundary + (target - s.boundary) * 0.1, 0, 1)

      // M10 自我展示：想让人看到哪一面——自尊高就想露，边界紧就不想
      s.presentation = clamp(s.esteem * 0.6 + (1 - s.boundary) * 0.4, 0, 1)

      // M11 归因中的自我：被指向时算自己还是算别人
      if (f.cold || f.command) {
        const self = s.esteem < 0.4 ? 0.65 : 0.35
        s.blameSelf = clamp(lerp2(s.blameSelf, self, 0.2), 0, 1)
      } else {
        s.blameSelf = clamp(lerp2(s.blameSelf, 0.5, 0.05), 0, 1)
      }

      s.frame += 1
    },

    read() {
      const topWord = Object.entries(s.selfWords).sort((a, b) => b[1] - a[1])[0] || null
      return {
        frame: s.frame,
        relevance: Number(s.relevance.toFixed(3)),
        esteem: Number(s.esteem.toFixed(3)),
        idealGap: Number(s.idealGap.toFixed(3)),
        discomfort: Number(s.discomfort.toFixed(3)),
        boundary: Number(s.boundary.toFixed(3)),
        protecting: Number(s.protecting.toFixed(3)),
        calm: Number(s.calm.toFixed(3)),
        presentation: Number(s.presentation.toFixed(3)),
        blameSelf: Number(s.blameSelf.toFixed(3)),
        selfImage: topWord ? { word: topWord[0], n: topWord[1] } : null,
        poked: s.hits.length ? s.hits[s.hits.length - 1].poked : 0,
        selfServing: Number(clamp(0.4 + 0.4 * (s.esteem - 0.5), 0, 1).toFixed(3)),
      }
    },

    snapshot: () => JSON.parse(JSON.stringify(s)),
    restore(o) { if (o) s = { ...fresh(), ...o } },
    health() { return { ok: true, frame: s.frame } },
  }
}

const lerp2 = (a, b, t) => a + (b - a) * t
