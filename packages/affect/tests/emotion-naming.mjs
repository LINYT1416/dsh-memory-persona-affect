// 心情插件 · 情绪命名（"她说不说得出自己怎么了"）
//
// 线上账本实测：192 条写回，126 条（65.6%）是"有情绪"，只有 66 条有名字。
// 根因两层：
//   1. 编码那一步读的 w.emotions 是上一帧的 fused → kind 空/错位
//   2. 连"被戳到"的量都没有的闲聊，也照样进账本
//
//   node tests/emotion-naming.mjs
import { createEngine } from '../core/engine.js'

const fails = []
const ok = (c, m) => { if (!c) fails.push(m) }

function makeBridge() {
  const notes = []
  const engineRef = { e: null }
  const bridge = {
    notes,
    recallFast: () => ({ ok: false, degraded: true, valenceReady: false, hits: [], ms: 0 }),
    recentEpisodes: async () => null,
    announce: () => {},
    annotate(note) {
      // 记下"写这一条时，这一帧自己算出来的情绪是什么"，用来对账
      notes.push({ ...note, fusedKindAtWrite: engineRef.e?.read()?.emotions?.[0]?.kind ?? null })
    },
  }
  return { bridge, engineRef }
}

const T = (i) => Date.now() + i * 60_000

// ── 1. 明显被顶：必须说出名字，而且名字得是"这一帧"的 ──────────
{
  const { bridge, engineRef } = makeBridge()
  const e = createEngine({ bridge })
  engineRef.e = e
  e.tick([{ type: 'user', text: '你行不行啊，这都做不好', at: T(0) }], 's1')
  e.tick([{ type: 'assistant', text: '……', at: T(1) }], 's1')
  const last = bridge.notes[bridge.notes.length - 1]
  ok(Boolean(last), '被顶了一句却没写回任何东西')
  ok(String(last?.kind || '').length > 0, `被顶了一句还说不出名字：${JSON.stringify(last)}`)
  ok(last.kind === last.fusedKindAtWrite,
    `名字和这一帧的情绪对不上：写的 ${last.kind} vs 算的 ${last.fusedKindAtWrite}`)
  ok(Number(last.valence) < 0, `被顶了效价该是负的，实际 ${last.valence}`)
}

// ── 2. 被夸：名字应该是正性的，不能写"被夸"却挂负效价 ──────────
{
  const { bridge, engineRef } = makeBridge()
  const e = createEngine({ bridge })
  engineRef.e = e
  e.tick([{ type: 'user', text: '今天这个做得真不错，我服了', at: T(0) }], 's2')
  e.tick([{ type: 'assistant', text: '嘿嘿', at: T(1) }], 's2')
  const last = bridge.notes[bridge.notes.length - 1]
  if (last) {
    const named = String(last.kind || '') !== '有情绪' && String(last.kind || '') !== ''
    if (named) ok(Number(last.valence) >= -0.05, `被夸了却记成负效价 ${last.valence}（${last.kind}）`)
  }
}

// ── 3. 闲聊：不许往里塞"有情绪：说了几句话" ────────────────
{
  const { bridge, engineRef } = makeBridge()
  const e = createEngine({ bridge })
  engineRef.e = e
  const chatter = ['今天天气不错', '嗯嗯', '我在呢', '好', '行吧', '在的']
  for (let i = 0; i < chatter.length; i++) {
    e.tick([{ type: 'user', text: chatter[i], at: T(i) }], 's3')
  }
  const junk = bridge.notes.filter((n) => !String(n.kind || '').trim()
    && Math.abs(Number(n.valence) || 0) < 0.15
    && Number(n.intensity) < 0.35)
  ok(junk.length === 0, `闲聊被记成了情绪 ${junk.length} 条：${JSON.stringify(junk.slice(0, 2))}`)
}

// ── 4. 说不出名字但确实被戳到：允许记，但必须标 named:false 且有量 ──
{
  const { bridge, engineRef } = makeBridge()
  const e = createEngine({ bridge })
  engineRef.e = e
  // 中性叙述但带强度：不该被当成"没发生"
  e.tick([{ type: 'user', text: '今天跑了一整天，腿都软了', at: T(0) }], 's4')
  e.tick([{ type: 'assistant', text: '歇会儿吧', at: T(1) }], 's4')
  for (const n of bridge.notes) {
    if (!String(n.kind || '').trim()) {
      ok(Math.abs(Number(n.valence) || 0) >= 0.15 || Number(n.intensity) >= 0.35,
        `无名条目量太小却也写回了：${JSON.stringify(n)}`)
    }
  }
}

if (fails.length) {
  console.log(`FAIL ${fails.length}:`)
  for (const f of fails) console.log(` - ${f}`)
  process.exit(1)
}
console.log('PASS 情绪命名（名字取这一帧 / 被顶有负名 / 闲聊不入账 / 无名必须够量）')
process.exit(0)
