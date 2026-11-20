// U01 不可及的动机：被问为什么时承认自己也不清楚（前提是真有件事惦记着）
import { opaqueMotive } from '../core/motive.js'

const fails = []
const ok = (c, m, d = '') => { if (!c) { fails.push(m + ' — ' + d); console.log('FAIL ' + m + (d ? ' — ' + d : '')) } }

// 没被问：不说
const notAsked = opaqueMotive({ pending: [{ text: '学吉他' }] }, '今天吃什么')
ok(notAsked.opaque === false && notAsked.because === 'not-asked', '没被问不该说动机不明', JSON.stringify(notAsked))

// 被问但没有惦记的事：不编
const empty = opaqueMotive({ pending: [] }, '你为什么这样')
ok(empty.opaque === false && empty.because === 'nothing-pending', '没惦记的事不该说动机不明', JSON.stringify(empty))

// 被问 + 有惦记的事 + 没写原因：承认说不清
const opaque = opaqueMotive({ pending: [{ text: '学吉他' }] }, '你为什么突然想学这个')
ok(opaque.opaque === true && /说不上为什么/.test(String(opaque.line)), '该承认说不清', JSON.stringify(opaque))

// 有写明原因：不许再说"说不上"
const explained = opaqueMotive({ pending: [{ text: '学吉他', why: '想给朋友弹一首' }] }, '为什么想学')
ok(explained.opaque === false && explained.because === 'has-reason', '有原因就不该说不清', JSON.stringify(explained))

// 混着：至少一件没原因就成立
const mixed = opaqueMotive({ pending: [{ text: 'a', why: 'b' }, { text: 'c' }] }, '你为什么')
ok(mixed.opaque === true, '混着时也该承认', JSON.stringify(mixed))

// 各种问法
for (const q of ['为什么', '为啥', '干嘛要', '怎么想起', '图什么']) {
  ok(opaqueMotive({ pending: [{ text: 'x' }] }, q).opaque === true, '问法没认出来: ' + q, '')
}

// 脏数据
const junk = opaqueMotive({ pending: 'x' }, '为什么')
ok(junk.opaque === false, '脏 pending 不该崩', JSON.stringify(junk))

if (fails.length) process.exit(1)
console.log('PASS 不可及动机（没问不说 / 没惦记不编 / 没写原因才承认 / 有原因不许装 / 混着也算 / 五种问法 / 脏数据）')
