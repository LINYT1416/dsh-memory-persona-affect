// 置信度必须是算出来的，不是写死的常量。
import { computeConfidence } from '../organs/hippocampus/lib/encode.js'

let fail = 0
const ok = (c, m) => { if (!c) { fail++; console.log('FAIL', m) } }

const factual = '我在卧安科技做具身机器人 EVT 可靠性测试，提了 30 多项优化建议'
const vague = '可能是这样吧，好像也行，大概也许'
const assistant = '今天把写入钩子修好了'

const u = computeConfidence({ role: 'user', text: factual, salience: 0.5 })
const a = computeConfidence({ role: 'assistant', text: factual, salience: 0.5 })
const v = computeConfidence({ role: 'user', text: vague, salience: 0.5 })
const hi = computeConfidence({ role: 'user', text: factual, salience: 0.8 })
const lo = computeConfidence({ role: 'user', text: factual, salience: 0.1 })

ok(u.value > a.value, `用户亲口(${u.value})应高于同文的我说的(${a.value})`)
ok(factual && v.value < u.value - 0.15, `含糊(${v.value})应明显低于具体(${u.value})`)
ok(hi.value > lo.value, `高显著(${hi.value})应高于低显著(${lo.value})`)
ok(u.value >= 0.15 && u.value <= 0.95, `值必须落在 [0.15,0.95]，实际 ${u.value}`)
ok(a.value >= 0.15 && a.value <= 0.95, `值必须落在 [0.15,0.95]，实际 ${a.value}`)
ok(Array.isArray(u.why) && u.why.length >= 2, '必须带理由数组')
ok(u.value !== a.value, '不能再是一个常量')

const ex = computeConfidence({ role: 'user', text: factual, explicit: 0.33 })
ok(Math.abs(ex.value - 0.33) < 1e-9 && ex.why[0] === 'explicit', '显式传入要原样保留')

ok(computeConfidence({ role: 'user', text: factual, salience: 0.5 }).value === u.value, '同样输入必须同结果')

console.log(fail ? `FAIL ${fail}` : `PASS 置信度是算出来的（具体 ${u.value} / 我的 ${a.value} / 含糊 ${v.value} / 显式 ${ex.value}）`)
process.exit(fail ? 1 : 0)
