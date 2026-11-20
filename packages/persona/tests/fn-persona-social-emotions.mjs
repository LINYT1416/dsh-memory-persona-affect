// V03 内疚 / V04 羞耻 / V05 骄傲 / E06 抑制与泄漏 / R09 记仇
// 前三条：心情侧只产出 心痛/委屈/生气，认不出这三样，所以人格侧按事件判。
// E06：真话是"忍住了但漏出来"——两条都要有断言。
import { socialEmotion } from '../core/social-emotion.js'
import { suppress } from '../core/suppress.js'
import { leak } from '../core/leak.js'
import { createLegacy } from '../core/legacy.js'

const fails = []
const ok = (c, m, d = '') => { if (!c) { fails.push(m + ' — ' + d); console.log('FAIL ' + m + (d ? ' — ' + d : '')) } }

// V05 骄傲：被夸 + 真做成过事
const pride = socialEmotion('你真棒好厉害', {}, { done: 3, failed: 0 })
ok(pride.kind === 'pride', '被夸且做成过该骄傲', JSON.stringify(pride))
ok(/飘一下|底气/.test(String(pride.line)), '骄傲的话要有分寸', String(pride.line))
// 没做成过事，光被夸：不算骄傲（那是讨好，不是骄傲）
ok(socialEmotion('你真棒', {}, { done: 0 }).kind !== 'pride', '没底气不该骄傲', JSON.stringify(socialEmotion('你真棒', {}, { done: 0 })))

// V04 羞耻
const shame = socialEmotion('你好丢人，真出丑', {}, {})
ok(shame.kind === 'shame', '被点出来该羞耻', JSON.stringify(shame))
ok(/耳朵都热|别说了/.test(String(shame.line)), '羞耻的话要像人话', String(shame.line))

// V03 内疚：认错 + 之前真伤过
const guilt = socialEmotion('是我的错，我搞砸了', { hurts: 2 }, { failed: 1 })
ok(guilt.kind === 'guilt', '认错且有账该内疚', JSON.stringify(guilt))
ok(/过不去/.test(String(guilt.line)), '内疚的话要沉一点', String(guilt.line))
ok(socialEmotion('是我的错', { hurts: 0 }, { failed: 0 }).kind !== 'guilt', '没造成后果不算内疚', '')

// 普通闲聊：不产生这三种
ok(socialEmotion('今天吃什么', {}, {}).kind === null, '平常不该煽情', '')

// E06 抑制与泄漏：忍得住一半，忍不住一半
const sup = suppress({ pcc: { crisis: 0.5 }, ofc: { guilt: 0.6 } }, { intimacy: 0.3 })
ok(sup.active === true, '情绪强且不熟该忍', JSON.stringify(sup))
const lk = leak({ ofc: { guilt: 0.7 }, str: { stop: 0.2 } })
ok(lk.leaked === true && typeof lk.line === 'string', '撑不住会漏出来', JSON.stringify(lk))
const lkTired = leak({ ofc: { guilt: 0.7 }, str: { stop: 0.95 } })
ok(lkTired.leaked === false, '太累了连漏都不漏', JSON.stringify(lkTired))
// 忍是"别让看出来"，漏是"半句没忍住"——两种口感不一样
ok(/别让看出来|忍住/.test(String(sup.directive || sup.line || '')), '忍的指令要明确', JSON.stringify(sup))
ok(String(lk.line || '').length <= 20, '漏出来的该是半句，不是一段话', String(lk.line))

// R09 记仇：同一件事反复被伤，会攒成"这次我不让了"
const lg = createLegacy()
for (let i = 0; i < 3; i++) lg.hurt('同一件事', 1_800_000_000_000 + i * 1000)
const grudge = lg.line(1_800_000_000_000 + 5000)
ok(Boolean(grudge), '被伤三次该有反应', String(grudge))
const fresh = createLegacy()
fresh.hurt('一次', 1_800_000_000_000)
ok(fresh.line(1_800_000_000_000 + 1000) === null, '只伤一次不该记仇', String(fresh.line(1_800_000_000_000 + 1000)))

if (fails.length) process.exit(1)
console.log('PASS 内疚+羞耻+骄傲+抑制泄漏+记仇（夸+做成才骄傲/羞耻认得出/内疚要有账/平常不煽情；忍住≠漏出/太累不漏；三次才记仇）')
