// 累积型探针：有些量不是一句话能看出来的，要跑够时长/轮次。
//   node tests/cumulative.mjs
import { createEngine } from '../core/engine.js'
import { render } from '../core/inject.js'

const fails = []
const ok = (c, m) => { if (!c) fails.push(m) }
const T0 = new Date('2026-11-12T09:00:00+08:00').getTime()

// 1. 一个人待着：越待越久，走神/发呆要涨，并且要能被看见
{
  let t = T0
  const e = createEngine({ now: () => t })
  e.tick([{ type: 'user', text: '在吗', at: t }])
  const w0 = e.organs.dmn.read().mindWander
  for (let i = 0; i < 24; i++) { t += 10 * 60_000; e.tick([]) }
  const w1 = e.organs.dmn.read().mindWander
  ok(w1 >= w0, `待两小时后走神不该更低（${w0.toFixed(2)} → ${w1.toFixed(2)}）`)
  const txt = render(e.read(), { hour: 23, tick: 6 })
  ok(/一个人待了挺久|走神/.test(txt), '一个人待久了，注入里该有点痕迹')
}

// 2. 缺觉是攒出来的：一天不睡，睡眠债要上去
{
  let t = T0
  const e = createEngine({ now: () => t })
  const d0 = e.organs.hypothalamus.snapshot().sleepDebt
  for (let i = 0; i < 16; i++) { t += 90 * 60_000; e.tick([{ type: 'user', text: '还在干活', at: t }]) }
  const d1 = e.organs.hypothalamus.snapshot().sleepDebt
  ok(d1 > d0, `二十四小时不睡，睡眠债该涨（${d0.toFixed(2)} → ${d1.toFixed(2)}）`)
  ok(d1 > 0.3, `熬一整天，睡眠债该明显（${d1.toFixed(2)}）`)
}

// 3. 长会话有疲劳：聊三十轮，执行余量该下来
{
  let t = T0
  const e = createEngine({ now: () => t })
  e.tick([{ type: 'user', text: '开始吧', at: t }])
  const f0 = e.organs.pfc.read().fatigue ?? 0
  for (let i = 0; i < 30; i++) {
    e.tick([{ type: 'user', text: i % 4 === 0 ? '你行不行啊又错了' : '继续', at: t }])
    t += 60_000
  }
  const f1 = e.organs.pfc.read().fatigue ?? 0
  ok(f1 >= f0, `聊三十轮，疲劳不该下降（${f0} → ${f1}）`)
}

// 4. 记忆攒起来：连续命中后，后扣带的锚点/章节要有个数
{
  let hits = 0
  const br = {
    ready: () => true,
    recallFast: () => { hits += 1; return { stage: 'ok', hits: [{ brief: '又来了，跟上次一样', valence: -0.3 }] } },
    status: () => ({}),
  }
  let t = T0
  const e = createEngine({ now: () => t, bridge: br })
  for (let i = 0; i < 6; i++) { e.tick([{ type: 'user', text: '又来了', at: t }]); t += 60_000 }
  const d = e.organs.dmn.snapshot()
  ok(d.anchors > 0 || d.anchorCount > 0, `连续命中六次，该有锚点（${JSON.stringify({ anchors: d.anchors, anchorCount: d.anchorCount })}）`)
}

// 5. 空结果不硬凑：一次都没命中的时候，锚点不能凭空长出来
{
  const br = { ready: () => true, recallFast: () => ({ stage: 'empty-hits', hits: [] }), status: () => ({}) }
  let t = T0
  const e = createEngine({ now: () => t, bridge: br })
  for (let i = 0; i < 6; i++) { e.tick([{ type: 'user', text: '全新的话题', at: t }]); t += 60_000 }
  const d = e.organs.dmn.snapshot()
  ok((d.anchors ?? 0) === 0 && (d.anchorCount ?? 0) === 0, `没命中时不该有锚点（${JSON.stringify({ anchors: d.anchors, anchorCount: d.anchorCount })}）`)
}

console.log(fails.length ? `FAIL ${fails.length}:\n- ${fails.join('\n- ')}` : 'PASS 累积型：久坐、缺觉、长会话疲劳、锚点累积、空结果不硬凑')
process.exit(fails.length ? 1 : 0)


