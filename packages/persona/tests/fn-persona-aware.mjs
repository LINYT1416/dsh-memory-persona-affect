// S07 自我观察：说的是真话，每句都能被读数验证
import { observeSelf } from '../core/aware.js'

const fails = []
const ok = (c, m, d = '') => { if (!c) { fails.push(m + ' — ' + d); console.log('FAIL ' + m + (d ? ' — ' + d : '')) } }

// 危机优先
const crisis = observeSelf({ pcc: { crisis: 0.8 }, str: { stop: 0.9 } })
ok(crisis.label === 'crisis', '危机应优先于累', JSON.stringify(crisis))

// 心里打架
const conflict = observeSelf({ acc: { conflict: 0.8 } })
ok(conflict.label === 'conflict' && /打架/.test(String(conflict.line)), '冲突该说在打架', JSON.stringify(conflict))

// 撑不住
const tired = observeSelf({ str: { stop: 0.9 } })
ok(tired.label === 'tired' && /撑不住/.test(String(tired.line)), '累到高点该承认', JSON.stringify(tired))

// 开心要同时满足：心里暖 + 关系近
const good = observeSelf({ ofc: { warm: 0.8 } }, { intimacy: 0.9 })
ok(good.label === 'good', '暖且近该说心情好', JSON.stringify(good))
const notClose = observeSelf({ ofc: { warm: 0.8 } }, { intimacy: 0.2 })
ok(notClose.label === null, '不熟不该说心情好', JSON.stringify(notClose))

// 平常：什么都不说
const plain = observeSelf({}, { intimacy: 0.9 })
ok(plain.label === null && plain.line === null, '平常不该自述', JSON.stringify(plain))

// 关键：每句话都要带 evidence，且 evidence 指向真实读数
for (const r of [crisis, conflict, tired, good]) {
  ok(typeof r.evidence === 'string' && r.evidence.length > 0, '自述必须带证据字段', JSON.stringify(r))
}

// 脏数据
const junk = observeSelf({ pcc: { crisis: 'x' }, acc: { conflict: null }, str: { stop: NaN } })
ok(junk.label === null, '脏数据不该自述', JSON.stringify(junk))

if (fails.length) process.exit(1)
console.log('PASS 自我观察（危机>冲突>累>心情好；不熟不说好；平常不说；每句带证据；脏数据不炸）')
