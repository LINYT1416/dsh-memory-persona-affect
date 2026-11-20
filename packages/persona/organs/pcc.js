// 后扣带 / 楔前叶：自传体自我。十条都要真跑。
// 没有记忆也能跑，只是"故事"短；接上记忆才长。

import { clamp, decay } from '../core/consts.js'

const DEFAULTS = {
  nostalgiaGain: 0.35,
  // 锚定门槛。这里量的是"显著度"（强度 × 时间），不是原始效价：
  // 心情侧真实效价 7 天均值只有 -0.149，拿 0.6 当线等于永远不锚定。
  // 0.12 ≈ 一次 -0.4 的情绪刚发生时就能进自传；一周前的同一件事要 0.4 出头才够。
  anchorAt: 0.12,
  chapterDays: 14,
  maxAnchors: 12,
  pullEveryTicks: 5,
}

export function create(cfg = {}) {
  const P = { ...DEFAULTS, ...cfg }
  const fresh = () => ({
    nostalgia: 0, continuity: 0.6, anchors: [], chapter: '',
    chapterAt: 0, pulls: 0, frame: 0,
    crisis: 0, future: 0, edited: 0, chapters: 1,
  })
  let s = fresh()

  const dayKey = (t) => new Date(t).toISOString().slice(0, 10)

  return {
    id: 'pcc',
    cover: ['P01', 'P02', 'P03', 'P04', 'P05', 'P06', 'P07', 'P08', 'P09', 'P10'],
    params: P,

    step(w) {
      const dt = w.tx.dtMs
      const now = w.tx.t1

      // P03 人生章节
      const days = Math.floor((now - (s.chapterAt || now)) / 86_400_000)
      if (!s.chapter || days >= P.chapterDays) {
        s.chapter = dayKey(now)
        s.chapterAt = now
        s.chapters += 1
      }

      // P01 自传提取
      s.pulls += 1
      // 首拍就要拉：以前只在 %5==0 时拉，刚启动永远没有故事。
      if (s.pulls === 1 || s.pulls % P.pullEveryTicks === 0) {
        const eps = Array.isArray(w.episodes) ? w.episodes : []
        if (eps.length) {
          let best = eps[0]
          let bestScore = -1
          for (const e of eps) {
            const ageDays = Math.max(0, (now - (e.at || now)) / 86_400_000)
            // 显著性 = 强度 × 时间。以前新鲜事的时间因子是 ageDays/7，
            // 刚发生的强情绪折算成 0 —— 人不是这样的，刺一下当时最疼。
            // 留 0.3 的地板：刚发生的重要事，现在就进得了自传。
            const rec = 0.3 + 0.7 * Math.min(1, ageDays / 7)
            const score = Math.abs(Number(e.valence) || 0) * rec
            if (score > bestScore) { bestScore = score; best = e }
          }
          if (bestScore > 0.02) {
            s.nostalgia = clamp(s.nostalgia + P.nostalgiaGain * bestScore, 0, 1)
            // P08 锚定：门槛定在"显著度"上，不是原始效价。
            // 以前要求 |valence| >= 0.6，而心情侧真实效价均值只有 -0.149，
            // 这条线现实中根本够不到 —— 于是锚点永远是 0（测试全绿，功能全空）。
            if (bestScore >= P.anchorAt) {
              const brief = String(best.brief || '').slice(0, 18)
              if (brief && !s.anchors.some((a) => a.brief === brief)) {
                // P09 故事编辑：旧锚太多就挤掉一个——记忆会挑着留
                if (s.anchors.length >= P.maxAnchors) {
                  s.anchors.shift()
                  s.edited += 1
                }
                s.anchors.push({ at: best.at || now, brief, v: Number(best.valence) || 0 })
              }
            }
          }
        }
      }

      s.nostalgia = clamp(s.nostalgia * decay(dt, 180), 0, 1)

      // P02 叙事连续性：用翻转率，不用瞬时
      const flip = Number(w.stable?.esteem?.flip) || 0
      const drift = Math.min(0.5, flip)
      const grown = Math.min(1, s.anchors.length / 5)
      s.continuity = clamp(0.78 - 0.6 * drift + 0.25 * grown, 0, 1)

      // P06 身份危机：又不像自己又没锚点解释
      const unexplained = Math.max(0, drift - grown * 0.5)
      s.crisis = clamp(s.crisis * decay(dt, 240) + (s.continuity < 0.5 && unexplained > 0.15 ? 0.12 : -0.04), 0, 1)

      // P07 未来自我：锚点越多越能想到"以后"，但危机高时会想不下去
      s.future = clamp(Math.min(1, s.anchors.length / 4) * (1 - s.crisis * 0.7), 0, 1)

      s.frame += 1
    },

    read() {
      return {
        frame: s.frame,
        nostalgia: Number(s.nostalgia.toFixed(3)),
        continuity: Number(s.continuity.toFixed(3)),
        crisis: Number(s.crisis.toFixed(3)),
        future: Number(s.future.toFixed(3)),
        chapter: s.chapter,
        chapters: s.chapters,
        edited: s.edited,
        anchors: s.anchors.slice(-3),
        anchorCount: s.anchors.length,
        // P10 时间线密度：章节里塞了几个锚
        density: Number((s.anchors.length / Math.max(1, s.chapters)).toFixed(2)),
        narrative: s.anchors.length ? `从${s.anchors[0].brief}之后就不太一样了` : '',
      }
    },

    snapshot: () => JSON.parse(JSON.stringify(s)),
    restore(o) { if (o) s = { ...fresh(), ...o } },
    health() { return { ok: true, frame: s.frame, anchors: s.anchors.length } },
  }
}
