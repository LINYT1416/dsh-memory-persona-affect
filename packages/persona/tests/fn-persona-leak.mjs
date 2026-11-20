// U03 口误与泄漏：压住的话从缝里漏半句
import { leak } from '../core/leak.js'

const fails = []
const ok = (c, m, d = '') => { if (!c) { fails.push(m + ' — ' + d); console.log('FAIL ' + m + (d ? ' — ' + d : '')) } }

// 什么都没有：不漏
const none = leak({})
ok(none.leaked === false && none.line === null, '什么都没有不该漏', JSON.stringify(none))

// 内疚：漏半句，且句子不完整
const guilt = leak({ ofc: { guilt: 0.8 } })
ok(guilt.leaked === true && /……/.test(String(guilt.line)), '内疚该漏成半句', JSON.stringify(guilt))
ok(!/我错了/.test(String(guilt.line)), '漏出来不该是完整认错', String(guilt.line))

// 被冒犯：否认但没否认干净
const off = leak({ tpj: { offense: 0.8 } })
ok(off.leaked === true && /不生气/.test(String(off.line)) && /……/.test(String(off.line)), '被冒犯该嘴硬又漏', JSON.stringify(off))

// 累到高点：不漏（全说或全不说）
const tired = leak({ ofc: { guilt: 0.9 }, str: { stop: 0.9 } })
ok(tired.leaked === false && tired.because === 'too-tired', '太累时不该漏', JSON.stringify(tired))

// 害臊
const shame = leak({ ofc: { shame: 0.8 } })
ok(shame.leaked === true && /忘了/.test(String(shame.line)), '害臊该说忘了又补一句', JSON.stringify(shame))

// 脏数据
const junk = leak({ ofc: { guilt: 'x' }, str: { stop: NaN } })
ok(junk.leaked === false, '脏数据不该漏', JSON.stringify(junk))

if (fails.length) process.exit(1)
console.log('PASS 口误与泄漏（内疚/被冒犯/害臊各自半句；太累不漏；脏数据不炸；漏出来的都不是完整表态）')
