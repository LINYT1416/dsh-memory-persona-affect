// 场景探针：阈值型/布尔型字段只在特定处境才动，单个白天句子测不出来。
//   node tests/scenarios.mjs
import { createEngine } from '../core/engine.js'
import { render } from '../core/inject.js'

const fails = []
const ok = (c, m) => { if (!c) fails.push(m) }
const at = (iso) => new Date(iso).getTime()

function run({ hour, sleepDebt = 0, text = '你行不行啊，说了几遍还是崩', ticks = 1 }) {
  let t = at(`2026-11-12T${String(hour).padStart(2, '0')}:00:00+08:00`)
  const e = createEngine({ now: () => t })
  if (sleepDebt) {
    const s = e.organs.hypothalamus.snapshot()
    s.sleepDebt = sleepDebt
    e.organs.hypothalamus.restore(s)
  }
  e.tick([{ type: 'user', text, at: t }])
  for (let i = 1; i < ticks; i++) { t += 60_000; e.tick([]) }
  return e
}

// 1. 缺觉 → 威胁增益更高（同一句话更扎）
{
  const a = run({ hour: 9, sleepDebt: 0 })
  const b = run({ hour: 9, sleepDebt: 0.85 })
  const ta = a.organs.amygdala.read().threat
  const tb = b.organs.amygdala.read().threat
  ok(tb >= ta, `缺觉后威胁不该更低（${ta.toFixed(3)} vs ${tb.toFixed(3)}）`)
  const fa = a.read(), fb = b.read()
  ok(fb.io.brevity >= fa.io.brevity - 0.02, `缺觉时话不该更长（${fa.io.brevity.toFixed(2)} vs ${fb.io.brevity.toFixed(2)}）`)
}

// 2. 缺觉要能被看见（注入里有"没睡够"那类句子）
{
  const e = run({ hour: 23, sleepDebt: 0.9 })
  const txt = render(e.read(), { hour: 23, tick: 0 })
  ok(/没睡够|缺觉/.test(txt), '缺觉时注入该提一句睡不够')
}

// 3. 长对话里，细微状态要轮换着露出来（不能总是那四条）
{
  let t = at('2026-11-12T21:00:00+08:00')
  const e = createEngine({ now: () => t })
  const seen = new Set()
  for (let i = 0; i < 18; i++) {
    e.tick([{ type: 'user', text: i % 3 === 0 ? '你行不行啊，又崩了' : '我们再看看这个', at: t }])
    const txt = render(e.read(), { hour: 22, tick: i })
    for (const line of txt.split('\n')) seen.add(line.replace(/\d+/g, '#'))
    t += 60_000
  }
  ok(seen.size >= 20, `十八轮里出现过的不同行太少（${seen.size}），说明没轮换`)
}

// 4. 注意力门关上时，正面线索不该被抬
{
  const e = createEngine({ now: () => at('2026-11-12T15:00:00+08:00') })
  const mod = e.organs.attention
  const orig = mod.read.bind(mod)
  mod.read = () => ({ ...orig(), gate: 0 })
  e.tick([{ type: 'user', text: '今天还行，谢谢你', at: Date.now() }])
  const rel = e.read().appraisal.relevance
  ok(rel < 0.9, `门关上后相关性不该还是满的（${rel}）`)
}

// 5. 没有编码时不该硬提旧事
{
  const hip = { recallSync: () => ({ ok: true, hits: [{ id: 'e', brief: '上次也这样', valence: -0.5 }] }) }
  const br = { ready: () => true, recallFast: () => ({ stage: 'ok', hits: [{ brief: '上次也这样', valence: -0.5 }] }), status: () => ({}) }
  let t = at('2026-11-12T20:00:00+08:00')
  const e = createEngine({ now: () => t, bridge: br })
  e.tick([{ type: 'user', text: '又崩了', at: t }])
  const echo = e.read().memoryEcho
  ok(!echo || (echo.hits || []).length <= 1, '回声最多一条，不能堆')
}

console.log(fails.length ? `FAIL ${fails.length}:\n- ${fails.join('\n- ')}` : 'PASS 场景探针：缺觉增益、缺觉可见、长对话轮换、注意门、回声上限、编码门')
process.exit(fails.length ? 1 : 0)


