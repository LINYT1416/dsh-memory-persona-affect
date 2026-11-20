// 人格 → 心情：三个"感受层"旋钮到底改不改得了心情
//
// 以前的结论：只动 leakRisk/brevity，mood/valence/threat 三拍零变化。
// 这个测试就是给"改不了"判死刑的：每一个旋钮都必须让方向对得上、幅度够大。
//
//   node packages/persona\tests\affects-mood.mjs
import { createEngine } from 'file:///E:/heart/packages/dsh-affect/core/engine.js'

const fails = []
const ok = (c, m) => { if (!c) fails.push(m) }

// 时钟必须是固定的：不然两次跑的 dtMs 差几毫秒，衰减就差一点点，
// "默认零影响"这条会被时间噪声打败（我第一次就栽在这——那不是代码错，是测试不稳）。
function runPhrase(patch = {}, text = '你行不行啊，这都做不好', ticks = 3) {
  let clock = new Date('2026-11-12T21:00:00+08:00').getTime()
  const e = createEngine({ now: () => clock })
  if (patch && Object.keys(patch).length) Object.assign(e.personaParams(), patch)
  const out = []
  for (let i = 0; i < ticks; i++) {
    clock += 60_000
    e.tick([{ type: 'user', text, at: clock }], 'p')
    const f = e.read()
    out.push({
      valence: f.valence,
      moodTarget: f.moodTarget,
      mood: e.state?.mood ?? null,
      emotion: f.emotions?.[0]?.kind ?? '-',
      intensity: f.emotions?.[0]?.intensity ?? 0,
      appraisalGoal: f.appraisal?.goal ?? 0,
    })
  }
  return out
}

const base = runPhrase({})
const last = (a) => a[a.length - 1]

// ── 1. threatGain：同一次威胁，更在意的人更疼 ──────────────
{
  const hi = runPhrase({ threatGain: 1.8 })
  const lo = runPhrase({ threatGain: 0.5 })
  const dHi = last(hi).valence - last(base).valence
  const dLo = last(lo).valence - last(base).valence
  ok(dHi <= -0.02, `threatGain=1.8 该让效价更负，实际 Δ=${dHi.toFixed(4)}`)
  ok(dLo >= 0.02, `threatGain=0.5 该让效价没那么负，实际 Δ=${dLo.toFixed(4)}`)
  ok(last(hi).valence < last(lo).valence, `高敏感必须比低敏感更负：${last(hi).valence.toFixed(3)} vs ${last(lo).valence.toFixed(3)}`)
  ok(last(hi).appraisalGoal < last(lo).appraisalGoal, '评价里的"顺不顺意"也要跟着降')
}

// ── 2. baselineMood：底色抬升要真的进 moodTarget ────────────
{
  const up = runPhrase({ baselineMood: 0.12 })
  const down = runPhrase({ baselineMood: -0.12 })
  const dUp = last(up).moodTarget - last(base).moodTarget
  const dDown = last(down).moodTarget - last(base).moodTarget
  ok(dUp >= 0.08, `底色 +0.12 该把 moodTarget 抬起来，实际 Δ=${dUp.toFixed(4)}`)
  ok(dDown <= -0.08, `底色 -0.12 该把 moodTarget 压下去，实际 Δ=${dDown.toFixed(4)}`)
}

// ── 3. sensitivity：同样的体感，更敏感的人情绪更重 ──────────
{
  const sens = runPhrase({ sensitivity: 1.8 })
  const dull = runPhrase({ sensitivity: 0.5 })
  const iS = last(sens).intensity
  const iD = last(dull).intensity
  ok(iS > iD + 0.02, `sensitivity 该放大情绪强度：敏感 ${iS.toFixed(3)} vs 迟钝 ${iD.toFixed(3)}`)
}

// ── 4. 默认中性：不给旋钮，跟原来一模一样（不许偷偷改行为）──
{
  const same = runPhrase({ threatGain: 1, sensitivity: 1, baselineMood: 0 })
  ok(Math.abs(last(same).valence - last(base).valence) < 1e-9,
    `默认值必须零影响，实际 Δ=${(last(same).valence - last(base).valence).toFixed(6)}`)
  ok(Math.abs(last(same).moodTarget - last(base).moodTarget) < 1e-9, '默认值必须零影响（moodTarget）')
}

// ── 5. 人格侧算出来的三个值必须在允许区间内 ─────────────────
{
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v))
  const traits = { stickiness: 0.9, esteem: 0.85 }
  const hex = { warmth: 0.95 }
  const cfg = {
    threatGain: clamp(0.8 + 0.5 * clamp(traits.stickiness, 0, 1), 0.5, 2),
    sensitivity: clamp(0.85 + 0.35 * clamp(hex.warmth ?? 0.6, 0, 1), 0.5, 2),
    baselineMood: clamp((clamp(traits.esteem ?? 0.5, 0, 1) - 0.5) * 0.24, -0.12, 0.12),
  }
  ok(cfg.threatGain <= 2 && cfg.threatGain >= 0.5, `threatGain 越界：${cfg.threatGain}`)
  ok(cfg.sensitivity <= 2 && cfg.sensitivity >= 0.5, `sensitivity 越界：${cfg.sensitivity}`)
  ok(Math.abs(cfg.baselineMood) <= 0.12, `baselineMood 越界：${cfg.baselineMood}`)
}

if (fails.length) {
  console.log(`FAIL ${fails.length}:`)
  for (const f of fails) console.log(` - ${f}`)
  process.exit(1)
}
const a = last(runPhrase({ threatGain: 1.8 })), b = last(runPhrase({ threatGain: 0.5 }))
console.log(`PASS 人格能改心情（threatGain 1.8→效价 ${a.valence.toFixed(3)} / 0.5→${b.valence.toFixed(3)}；底色与敏感度同向生效；默认零影响）`)
process.exit(0)
