// 合并路径也要有置信度：同段再来一条消息，不是新建 episode。
import { mergeConfidence, computeConfidence } from '../organs/hippocampus/lib/encode.js'

let fail = 0
const ok = (c, m) => { if (!c) { fail++; console.log('FAIL', m) } }

const raw = { confidence: 0.77, confidenceBase: 0.77, confidenceWhy: ['base:user', '+length'] }

// 1) 段里原来没有底 → 合并后带上
const ep1 = { id: 'e1', rawIds: ['r1'] }
const m1 = mergeConfidence(ep1, raw)
ok(m1 && m1.confidenceBase === 0.77, `应继承 0.77 的底，实际 ${JSON.stringify(m1)}`)
ok(m1.confidence >= 0.77, `置信度不该低于底，实际 ${m1?.confidence}`)
ok(m1.confidenceWhy.includes('base:user'), '理由要带过来')

// 2) 已有更高的底 → 取较高，不降
const ep2 = { id: 'e2', rawIds: ['r1', 'r2', 'r3'], confidence: 0.85, confidenceBase: 0.85, confidenceWhy: ['+salience'] }
const m2 = mergeConfidence(ep2, { confidence: 0.6, confidenceBase: 0.6, confidenceWhy: ['-hedged'] })
ok(m2.confidenceBase === 0.85, `应保留较高的底 0.85，实际 ${m2.confidenceBase}`)
ok(m2.confidence <= 0.9, `不该超过 0.9，实际 ${m2.confidence}`)
ok(m2.confidenceWhy.length >= 2, '理由要合并')

// 3) 没有底的旧数据不硬造
const m3 = mergeConfidence({ id: 'e3', rawIds: [] }, {})
ok(m3 === null, `没有底应返回 null，实际 ${JSON.stringify(m3)}`)

// 4) 合并多次也不会飞
let ep4 = { id: 'e4', rawIds: ['a'], confidence: 0.7, confidenceBase: 0.7, confidenceWhy: [] }
for (let i = 0; i < 30; i++) {
  ep4 = { ...ep4, ...mergeConfidence(ep4, raw), rawIds: [...ep4.rawIds, 'x'] }
}
ok(ep4.confidence <= 0.9, `反复合并封顶 0.9，实际 ${ep4.confidence}`)

// 5) 计算式置信度和合并口径一致：base 就是写入时算的值
const c = computeConfidence({ role: 'user', text: '我在卧安做 EVT 可靠性测试，提了 30 多项建议', salience: 0.5 })
ok(Math.abs(c.value - (mergeConfidence({ id: 'e5', rawIds: ['r'] }, { confidence: c.value, confidenceBase: c.value }).confidenceBase)) < 1e-9, 'base 应等于写入时的计算值')

console.log(fail ? `FAIL ${fail}` : `PASS 合并段置信度（继承底 + 取高不降 + 理由合并 + 封顶 0.9 + 旧数据不硬造）`)
process.exit(fail ? 1 : 0)
