// 共情准不准 / 一件事黏不黏 —— 默认 0.5，必须看偏离量
import { describe } from '../core/desc.js'

const fails = []
const ok = (c, m, d = '') => { if (!c) { fails.push(m + ' — ' + d); console.log('FAIL ' + m + (d ? ' — ' + d : '')) } }
const mk = (o) => describe({ reads: o }, { max: 14, prev: [] }).join(' | ')

// empathy 高值不再出话：那个读数在真实对话里恒接近 1，说了就是假阳性
ok(!/没说出口|嘴上说没事/.test(mk({ tpj: { empathy: 0.85 } })), '共情高时不该再宣称"我懂他"', mk({ tpj: { empathy: 0.85 } }))
ok(/拿不太准|猜不透/.test(mk({ tpj: { empathy: 0.1 } })), '共情低时该说"拿不准"', mk({ tpj: { empathy: 0.1 } }))
ok(/赖着不走|还在脑子里/.test(mk({ acc: { sticky: 0.85 } })), '黏着高时该说"赖着不走"', mk({ acc: { sticky: 0.85 } }))
ok(/翻篇就翻篇|不往回捡/.test(mk({ acc: { sticky: 0.1 } })), '黏着低时该说"翻篇"', mk({ acc: { sticky: 0.1 } }))

// 关键：默认 0.5 不能触发任何一条
const dflt = mk({ tpj: { empathy: 0.5 }, acc: { sticky: 0.5 } })
ok(!/没说出口|拿不太准|赖着不走|翻篇就翻篇/.test(dflt), '默认值就说话了', dflt.slice(0, 200))

// 一高一低不能同时出现
const mixed = mk({ tpj: { empathy: 0.9 }, acc: { sticky: 0.9 } })
ok(!/没说出口|嘴上说没事/.test(mixed), '共情高时又冒出"我懂他"了', mixed.slice(0, 200))
ok(!/拿不太准/.test(mixed), '共情高却同时说不准', mixed.slice(0, 200))

if (fails.length) process.exit(1)
console.log('PASS 共情/黏着（高低各自成立；默认 0.5 闭嘴；高时不说反话）')
