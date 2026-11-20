// 又接四条"只出数"的读数：值不值 / 话说得直 / 被扎疼 / 跟我有关
import { describe } from '../core/desc.js'

const fails = []
const ok = (c, m, d = '') => { if (!c) { fails.push(m + ' — ' + d); console.log('FAIL ' + m + (d ? ' — ' + d : '')) } }
const mk = (o) => describe({ reads: o }, { max: 12, prev: [] }).join(' | ')

ok(/值不值得|不太值/.test(mk({ ofc: { value: 0.85 } })), 'ofc.value 没进注入', mk({ ofc: { value: 0.85 } }))
ok(/话说得有点直|冲了点/.test(mk({ tpj: { blunt: 0.9 } })), 'tpj.blunt 没进注入', mk({ tpj: { blunt: 0.9 } }))
ok(/扎疼|真疼/.test(mk({ acc: { pain: 0.8 } })), 'acc.pain 没进注入', mk({ acc: { pain: 0.8 } }))
ok(/跟我有点关系|说的就是我/.test(mk({ mpfc: { relevance: 0.9 } })), 'mpfc.relevance 没进注入', mk({ mpfc: { relevance: 0.9 } }))

// 阈值以下的读数不许冒出来（避免"有一点点就说")
const low = mk({ ofc: { value: 0.3 }, tpj: { blunt: 0.2 }, acc: { pain: 0.1 }, mpfc: { relevance: 0.2 } })
ok(!/值不值得|冲了点|扎疼|说的就是我/.test(low), '阈值以下也冒出来了', low.slice(0, 160))

if (fails.length) process.exit(1)
console.log('PASS 四条读数接线（值不值/直/疼/相关 各自能说；阈值以下闭嘴）')
