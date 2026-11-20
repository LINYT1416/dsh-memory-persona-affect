// 纹状体：习惯与动机。
// A 段快匹配（看见就接），B 段固化。十四条都要真跑，不许只出个数。

import { clamp, decay, hash } from '../core/consts.js'

const DEFAULTS = {
  habitGain: 0.35,
  decayH: 72,
  wantBias: 0.5,
  ritualLen: 3,
  breakPenalty: 0.25,
  stopGain: 0.2,
  satiation: 0.12,
  exploreRate: 0.08,
  phraseLen: 10,
}

export function create(cfg = {}) {
  const P = { ...DEFAULTS, ...cfg }
  const fresh = () => ({
    habits: {}, primed: 0, cue: '', lastCue: '', streak: 0,
    broken: 0, wanting: 0, liking: 0, ritual: 0,
    phrases: {}, stop: 0, satiation: {}, learnedFrom: {},
    explore: 0, frame: 0,
  })
  let s = fresh()

  // 相邻线索：习惯会渗过去，人换场景也带着老毛病
  const NEAR = { ask: 'talk', talk: 'ask', vent: 'talk', ping: 'greet', greet: 'ping' }

  return {
    id: 'str',
    cover: ['S01', 'S02', 'S03', 'S04', 'S05', 'S06', 'S07', 'S08', 'S09', 'S10', 'S11', 'S12', 'S13', 'S14'],
    params: P,

    fast(w) {
      const cue = w.tx.cue || 'talk'
      const f = w.tx.f || {}
      s.cue = cue

      // 线索（记住什么）用粗分类；"连着同一类"（仪式/停不下来）要用细一点的形状，
      // 否则日常对话全被归成 talk，仪式永远成立、stop 一直涨，读到饱和就成了一张死脸。
      const bucket = (f.len || 0) <= 6 ? 's' : (f.len || 0) <= 20 ? 'm' : 'l'
      const shape = `${cue}:${bucket}:${f.question ? 'q' : ''}`

      const own = s.habits[cue]?.s || 0
      // S12 习惯迁移：自己没形成，但邻着的那个已经熟了，也会带一点
      const near = NEAR[cue] ? (s.habits[NEAR[cue]]?.s || 0) * 0.35 : 0
      s.primed = clamp(Math.max(own, near), 0, 1)

      if (shape === s.lastCue) {
        s.streak += 1
      } else {
        if (s.streak >= P.ritualLen) s.broken = clamp(s.broken + P.breakPenalty, 0, 1)
        s.streak = 1
        s.lastCue = shape
      }
      // S07 仪式：连着同一类形状，就是在走固定流程
      if (s.streak >= P.ritualLen) s.ritual = clamp(s.ritual + 0.08, 0, 1)
      // S10 停止信号：越顺越停不下来
      s.stop = clamp(s.stop + (s.streak >= P.ritualLen ? P.stopGain : -0.05), 0.05, 1)

      // S08 口头禅：短句反复出现，就是她的口癖
      const t = String(w.tx.text || '').trim()
      if (t && [...t].length <= P.phraseLen) {
        s.phrases[t] = (s.phrases[t] || 0) + 1
        const keys = Object.keys(s.phrases)
        if (keys.length > 12) {
          keys.sort((a, b) => s.phrases[a] - s.phrases[b])
          delete s.phrases[keys[0]]
        }
      }
    },

    step(w) {
      const dt = w.tx.dtMs
      const dec = decay(dt, P.decayH * 60)

      for (const k of Object.keys(s.habits)) {
        s.habits[k].s *= dec
        if (s.habits[k].s < 0.01) delete s.habits[k]
      }

      const value = w.get('ofc')?.value ?? 0.5
      const cue = s.cue
      if (cue) {
        const h = s.habits[cue] || (s.habits[cue] = { n: 0, s: 0, w: 0 })
        h.n += 1
        const pe = clamp(value - 0.5, -0.5, 0.5)
        // S13 惩罚学得快：负的预测误差权重翻倍
        const gain = pe < 0 ? P.habitGain * 2 : P.habitGain
        // S11 奖赏贬值：同一份好东西重复给，习惯强度涨得越来越少（腻了）
        h.s = clamp(h.s + gain * (0.25 + pe) * (1 - clamp(s.satiation[cue] || 0, 0, 0.8)), 0, 1)
        h.w = clamp(h.w + (pe < 0 ? 0.2 : 0.05), 0, 1)
        h.at = w.tx.t1

        // S11 奖赏贬值：同一个线索一直带来同一份好，就腻
        s.satiation[cue] = clamp((s.satiation[cue] || 0) + P.satiation * Math.max(0, value - 0.5), 0, 1)
      }

      const relevance = w.get('mpfc')?.relevance ?? 0.4
      // S04 冲动 / S05 想要≠喜欢：想要涨得快，喜欢涨得慢
      s.wanting = clamp(s.wanting * decay(dt, 45) + P.wantBias * relevance * 0.15, 0, 1)
      s.liking = clamp(s.liking * decay(dt, 90) + Math.max(0, value - 0.5) * 0.08, 0, 1)

      // S14 探索：偶尔不按习惯来。用文本哈希做确定性抖动，不用随机数
      const jitter = (parseInt(hash(String(w.tx.text || '') + s.frame), 36) % 1000) / 1000
      s.explore = jitter < P.exploreRate ? 1 : 0

      s.ritual = clamp(s.ritual * decay(dt, 120), 0, 1)
      s.broken = clamp(s.broken * decay(dt, 240), 0, 1)
      s.stop = clamp(s.stop * decay(dt, 30), 0.02, 1)
      s.frame += 1
    },

    read() {
      const top = Object.entries(s.habits)
        .map(([k, v]) => ({ cue: k, s: Number(v.s.toFixed(3)), n: v.n, w: Number(v.w.toFixed(2)) }))
        .sort((a, b) => b.s - a.s)
        .slice(0, 3)
      const phrase = Object.entries(s.phrases).sort((a, b) => b[1] - a[1])[0] || null
      return {
        frame: s.frame,
        cue: s.cue,
        primed: Number(s.primed.toFixed(3)),
        streak: s.streak,
        ritual: Number(s.ritual.toFixed(3)),
        broken: Number(s.broken.toFixed(3)),
        stop: Number(s.stop.toFixed(3)),
        wanting: Number(s.wanting.toFixed(3)),
        liking: Number(s.liking.toFixed(3)),
        // S04：想要远大于喜欢，就是停不下来又没劲
        compulsionGap: Number(Math.max(0, s.wanting - s.liking).toFixed(3)),
        satiation: Number((s.satiation[s.cue] || 0).toFixed(3)),
        explore: s.explore,
        phrase: phrase ? { text: phrase[0], n: phrase[1] } : null,
        top,
        habitCount: Object.keys(s.habits).length,
      }
    },

    snapshot: () => JSON.parse(JSON.stringify(s)),
    restore(o) { if (o) s = { ...fresh(), ...o } },
    health() { return { ok: true, frame: s.frame, habits: Object.keys(s.habits).length } },
  }
}
