// S06 自我欺骗：说出口的话要和自己读数方向相反，条件不成立就不许说
import { rationalize } from '../core/deceive.js'

const fails = []
const ok = (c, m, d = '') => { if (!c) { fails.push(m + ' — ' + d); console.log('FAIL ' + m + (d ? ' — ' + d : '')) } }

// 做成率低 → 贬低目标
const low = rationalize({}, { done: 1, failed: 5 })
ok(low.claim === 'devalue', '做成率低时应该贬低目标', JSON.stringify(low))
ok(/没什么意思/.test(String(low.line)), '措辞不对', String(low.line))

// 做成率高 → 不许找台阶
const high = rationalize({}, { done: 5, failed: 1 })
ok(high.line === null, '做得成时不该找台阶', JSON.stringify(high))

// 样本太少 → 不许下结论
const few = rationalize({}, { done: 0, failed: 1 })
ok(few.line === null, '样本太少不该找台阶', JSON.stringify(few))

// 自尊低 → 否认在意
const esteem = rationalize({ mpfc: { esteem: 0.2 } }, {})
ok(esteem.claim === 'indifferent', '低自尊该否认在意', JSON.stringify(esteem))

// 自尊正常 → 不许说
const normal = rationalize({ mpfc: { esteem: 0.6 } }, {})
ok(normal.line === null, '自尊正常不该否认', JSON.stringify(normal))

// 累了 → 说"还能撑"
const tired = rationalize({ str: { stop: 0.9 } }, {})
ok(tired.claim === 'fine', '累时该说还能撑', JSON.stringify(tired))

// 关键断言：说的方向必须和读数相反
ok(tired.line && !/累/.test(tired.line), '说"还能撑"时不该承认累', String(tired.line))
ok(esteem.line && !/难过|在意/.test(esteem.line), '否认在意时不该露馅', String(esteem.line))

// 脏数据
const junk = rationalize({ mpfc: { esteem: 'x' }, str: { stop: NaN } }, { done: 'a', failed: NaN })
ok(typeof junk.line === 'string' || junk.line === null, '脏数据不该抛', JSON.stringify(junk))

if (fails.length) process.exit(1)
console.log('PASS 自我欺骗（低成率贬目标/低自尊否认在意/累说能撑；条件不成立不找台阶；方向必与读数相反）')
