// 习惯化 / 被暖到 / 端不端着 —— 三条结构性读数接进注入
import { describe } from '../core/desc.js'

const fails = []
const ok = (c, m, d = '') => { if (!c) { fails.push(m + ' — ' + d); console.log('FAIL ' + m + (d ? ' — ' + d : '')) } }
const mk = (o) => describe({ reads: o }, { max: 14, prev: [] }).join(' | ')

ok(/这一套|老一套/.test(mk({ str: { ritual: 0.8 } })), 'str.ritual 没进注入', mk({ str: { ritual: 0.8 } }))
ok(/暖到|记着/.test(mk({ ofc: { favors: 0.85 } })), 'ofc.favors 没进注入', mk({ ofc: { favors: 0.85 } }))
ok(/端着/.test(mk({ mpfc: { presentation: 0.9 } })), 'presentation 高时该说端着', mk({ mpfc: { presentation: 0.9 } }))
ok(/不用装|松的/.test(mk({ mpfc: { presentation: 0.1 } })), 'presentation 低时该说不装', mk({ mpfc: { presentation: 0.1 } }))

// 端着的和不装的两句不能同时出现（同一个人不可能又端又松）
const mid = mk({ mpfc: { presentation: 0.5 } })
ok(!/端着/.test(mid) && !/不用装/.test(mid), '中间值不该说任何一边', mid.slice(0, 160))

const plain = mk({})
ok(!/端着|不用装|暖到|这一套/.test(plain), '平常状态冒出来了', plain.slice(0, 160))

if (fails.length) process.exit(1)
console.log('PASS 三条结构性读数（习惯化/被暖到/端不端着；中间值与平常都闭嘴）')
