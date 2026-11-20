// 仪表页数据检查：字段齐全、范围合法、HTML 自包含。
//   node tests/dashboard.mjs
import { summarize, dashboardHtml } from '../core/dashboard.js'
import { createEngine } from '../core/engine.js'

const clock = new Date('2026-11-11T20:30:00+08:00').getTime()
const engine = createEngine({ now: () => clock })
engine.tick([{ type: 'user', text: '今天好累啊，不想动', at: clock }])

const d = summarize(engine)
const fails = []
const ok = (c, m) => { if (!c) fails.push(m) }

const need = ['at', 'tick', 'headline', 'mood', 'valence', 'arousal', 'emotions', 'target', 'body', 'dimensions', 'mind', 'social', 'needs', 'memory', 'curve', 'output', 'trace']
for (const k of need) ok(d[k] !== undefined, `缺字段 ${k}`)

ok(d.mood.pct >= 0 && d.mood.pct <= 100, '心情百分比越界')
ok(d.dimensions.length >= 10, '维度少于 10 个')
ok(d.dimensions.every(x => x.v >= 0 && x.v <= 100), '维度数值越界')
ok(typeof d.body.hr === 'number' && d.body.hr >= 40 && d.body.hr <= 200, '心率异常')
ok(Array.isArray(d.emotions) && d.emotions.every(e => e.intensity >= 0 && e.intensity <= 100), '情绪列表异常')
ok(typeof d.memory.count === 'number', '记忆条数异常')
ok(['soft', 'normal', 'hard', 'flat'].includes(d.output.tone), '语气枚举异常')
ok(Array.isArray(d.trace), 'trace 不是数组')

// 不崩：缓存为空时 summarize 也能自举
const e2 = createEngine({ now: () => clock })
const d2 = summarize(e2)
ok(d2 && typeof d2.headline === 'string', '空引擎 summarize 应能自举')

const html = dashboardHtml()
ok(html.startsWith('<!doctype html>'), 'HTML 头缺失')
ok(html.includes('/affect/live'), 'HTML 没接 /affect/live')
ok(!/https?:\/\//.test(html), 'HTML 不该引外网资源')
ok(html.includes('setInterval'), 'HTML 没有自动刷新')

// 表情包联动：心情好 → 多发开心；心情差 → 少发丧的
const happy = createEngine({ now: () => clock, persona: { moodBase: 0.7 } })
happy.tick([{ type: 'user', text: '今天真不错', at: clock }])
const mh = happy.organs.io.read().meme
const sad = createEngine({ now: () => clock, persona: { moodBase: -0.6 } })
sad.tick([{ type: 'user', text: '算了', at: clock }])
const ms = sad.organs.io.read().meme
ok(mh.style === 'bright' && mh.emotion === 'happy', `心情好应发开心类（${JSON.stringify(mh)}）`)
ok(ms.style === 'emo' && ms.emotion === 'sad', `心情差应发丧的（${JSON.stringify(ms)}）`)
ok(mh.probability > ms.probability, `心情好时频率应更高（${mh.probability.toFixed(2)} vs ${ms.probability.toFixed(2)}）`)

console.log(fails.length ? `FAIL ${fails.length}:\n- ` + fails.join('\n- ') : `PASS 仪表页数据 ${d.dimensions.length} 维、字段齐全、HTML 自包含`)
console.log('样例：', d.headline, '| 维度', d.dimensions.map(x => x.key + ':' + x.v).join(' '))
process.exit(fails.length ? 1 : 0)
