// U02 不知道自己状态：被问到时读数全平，才承认说不清；有明显信号就照实说
import { unclearState } from '../core/unclear.js'

const fails = []
const ok = (c, m, d = '') => { if (!c) { fails.push(m + ' — ' + d); console.log('FAIL ' + m + (d ? ' — ' + d : '')) } }

// 没被问：不主动说不知道
const notAsked = unclearState({}, '今天吃什么')
ok(notAsked.unclear === false && notAsked.because === 'not-asked', '没被问不该装糊涂', JSON.stringify(notAsked))

// 被问 + 信号全平：说不清
const flat = unclearState({}, '你怎么了')
ok(flat.unclear === true && /说不上来/.test(String(flat.line)), '读数全平时该承认说不清', JSON.stringify(flat))

// 被问 + 有明显信号：说得清，不许装糊涂
const tired = unclearState({ str: { stop: 0.9 } }, '你怎么了')
ok(tired.unclear === false && tired.because === 'has-signal', '有信号时不该装糊涂', JSON.stringify(tired))

const crisis = unclearState({ pcc: { crisis: 0.9 } }, '你还好吗')
ok(crisis.unclear === false, '危机时更不该装糊涂', JSON.stringify(crisis))

const lowEsteem = unclearState({ mpfc: { esteem: 0.1 } }, '你没事吧')
ok(lowEsteem.unclear === false, '低自尊也算有信号', JSON.stringify(lowEsteem))

// 问法不同也能认出来
for (const q of ['你怎么了', '你还好吗', '是不是不舒服']) {
  ok(unclearState({}, q).unclear === true, '问法没认出来: ' + q, '')
}

// 脏数据
const junk = unclearState({ pcc: { crisis: 'x' }, str: { stop: NaN } }, '你怎么了')
ok(junk.unclear === true, '脏数据该当平', JSON.stringify(junk))

if (fails.length) process.exit(1)
console.log('PASS 不知道自己状态（没问不说 / 全平才承认 / 有信号不装糊涂 / 多种问法 / 脏数据当平）')
