// X05 幽默：心情好自嘲，被惹损人；正经/诉苦/火头上不许贫
import { humor } from '../core/humor.js'

const fails = []
const ok = (c, m, d = '') => { if (!c) { fails.push(m + ' — ' + d); console.log('FAIL ' + m + (d ? ' — ' + d : '')) } }

// 正经事：不许贫
const serious = humor({ ofc: { warm: 0.9 } }, '帮我看下这个报错怎么解决')
ok(serious.mode === null && serious.because === 'wrong-moment', '正经事不该耍嘴', JSON.stringify(serious))

// 对方在诉苦：不许贫
const vent = humor({ ofc: { warm: 0.9 } }, '今天好累，撑不住了')
ok(vent.mode === null, '诉苦时不该贫', JSON.stringify(vent))

// 火头上（对方发火）：也不许贫
const angry = humor({ tpj: { offense: 0.9 } }, '闭嘴吧你烦不烦')
ok(angry.mode === null, '对方发火时不该贫', JSON.stringify(angry))

// 心情好 + 闲聊：自嘲
const good = humor({ ofc: { warm: 0.8 } }, '在吗')
ok(good.mode === 'self' && /脑子|不太聪明/.test(String(good.line)), '心情好该自嘲', JSON.stringify(good))

// 被惹到（但不是发火）：损对方
const tease = humor({ tpj: { offense: 0.6 } }, '哈哈你又搞错了')
ok(tease.mode === 'tease', '被惹到该损人', JSON.stringify(tease))

// 崩了：不贫
const crisis = humor({ ofc: { warm: 0.9 }, pcc: { crisis: 0.6 } }, '在吗')
ok(crisis.mode === null && crisis.because === 'crisis', '崩了不该贫', JSON.stringify(crisis))

// 平常：不贫
const flat = humor({}, '在吗')
ok(flat.mode === null && flat.because === 'flat', '平常不该硬贫', JSON.stringify(flat))

// 两种模式的话不重叠
ok(good.line !== tease.line, '自嘲和损人应该是两种话', good.line + ' vs ' + tease.line)

// 脏数据
const junk = humor({ ofc: { warm: 'x' }, tpj: { offense: NaN } }, '在吗')
ok(junk.mode === null, '脏数据不该贫', JSON.stringify(junk))

if (fails.length) process.exit(1)
console.log('PASS 幽默（正经/诉苦/发火/崩了都不贫；心情好自嘲；被惹损人；平常不硬贫；两种话不重叠）')
