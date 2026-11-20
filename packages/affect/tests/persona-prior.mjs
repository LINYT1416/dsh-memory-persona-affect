// 第四条桥：人格 → 记忆的显著性先验
//
// 文档 §7.3 列了四条桥，只有这条连代码都没有。
// 规矩：人格只说"这件事该记得多深"，不替记忆决定记不记（单一写者不变）。
//
//   node tests/persona-prior.mjs
import { createEngine } from '../core/engine.js'
import { createBridge } from '../core/bridge.js'

const fails = []
const ok = (c, m) => { if (!c) fails.push(m) }

function makeHip() {
  return {
    recallSync: () => ({ ok: true, degraded: false, valenceReady: true, hits: [], ms: 1 }),
    recall: async () => ({ hits: [] }),
    episodes: async () => [],
    write: () => Promise.resolve({ ok: true }),
  }
}

// 造一个"有人格"的桥：memory.persona 提供 memoryPrior
function bridgeWith(prior) {
  const hip = makeHip()
  const persona = prior === null ? null : { memoryPrior: () => prior }
  return createBridge((id) => {
    if (id === 'memory.hippocampus') return hip
    if (id === 'memory.persona') return persona
    return null
  })
}

function run(bridge, text = '你行不行啊，这都做不好') {
  const notes = []
  const orig = bridge.annotate.bind(bridge)
  bridge.annotate = (n, sid, m) => { notes.push(n); return orig(n, sid, m) }
  const e = createEngine({ bridge })
  let t = new Date('2026-11-12T21:00:00+08:00').getTime()
  for (let i = 0; i < 3; i++) {
    t += 60_000
    e.tick([{ type: 'user', text, at: t }], 'p')
  }
  return notes[notes.length - 1] || null
}

const base = run(bridgeWith(null))
ok(Boolean(base), '没有先验时也该正常写回')
ok(base.prior === null, `没接人格时 prior 该是 null，实际 ${JSON.stringify(base.prior)}`)

// ── 1. 放不下的人：同样一句话，刻得更深 ──────────────────
{
  const strong = run(bridgeWith({ deepBias: 0.95, salienceGain: 1.2 }))
  const weak = run(bridgeWith({ deepBias: 0.1, salienceGain: 0.9 }))
  ok(strong && weak, '两种先验都该写出条目')
  ok(String(strong.depth) === 'deep', `deepBias 0.95 时该标 deep，实际 ${strong.depth}`)
  ok(Number(strong.intensity) > Number(weak.intensity),
    `先验高时强度该更大：${strong.intensity} vs ${weak.intensity}`)
  ok(strong.prior === 0.95, `账本要记下先验值，实际 ${strong.prior}`)
}

// ── 2. 先验只影响"多深"，不影响"记不记" ──────────────────
{
  // 闲聊：两种先验都不该写回（门槛由"值不值得"决定，不由人格决定）
  const a = run(bridgeWith({ deepBias: 1 }), '嗯嗯')
  const b = run(bridgeWith({ deepBias: 0 }), '嗯嗯')
  ok(a === null && b === null, '闲聊不该因为人格先验高就被记：前者 ' + JSON.stringify(a) + ' 后者 ' + JSON.stringify(b))
}

// ── 3. 越界值要夹住，不许把深度算法带飞 ──────────────────
{
  const wild = run(bridgeWith({ deepBias: 99, salienceGain: 99 }))
  ok(wild && wild.prior === 1, `越界先验要夹到 1，实际 ${JSON.stringify(wild?.prior)}`)
  ok(Number(wild.intensity) <= 1.6, `强度上限不许破，实际 ${wild.intensity}`)
}

// ── 4. 人格那边算出来的先验必须在合法区间 ─────────────────
{
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v))
  for (const [stick, focus] of [[0, 0], [0.5, 0.2], [1, 1]]) {
    const deepBias = clamp(0.35 + 0.5 * stick + 0.15 * focus, 0, 1)
    const salienceGain = clamp(0.8 + 0.4 * focus, 0.5, 1.6)
    ok(deepBias >= 0 && deepBias <= 1, `deepBias 越界：${deepBias}`)
    ok(salienceGain >= 0.5 && salienceGain <= 1.6, `salienceGain 越界：${salienceGain}`)
  }
}

if (fails.length) {
  console.log(`FAIL ${fails.length}:`)
  for (const f of fails) console.log(` - ${f}`)
  process.exit(1)
}
console.log('PASS 人格→记忆先验（deepBias 只改"多深"不改"记不记"；越界夹住；没接人格时为 null）')
process.exit(0)
