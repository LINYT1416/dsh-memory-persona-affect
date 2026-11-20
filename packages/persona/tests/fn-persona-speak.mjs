// X12 发言决策：说、不说、说几条
import { decideSpeak } from '../core/speak.js'

const fails = []
const ok = (c, m, d = '') => { if (!c) { fails.push(m + ' — ' + d); console.log('FAIL ' + m + (d ? ' — ' + d : '')) } }

// 崩/危机 → 一句
const crisis = decideSpeak({ pcc: { crisis: 0.8 } })
ok(crisis.lines === 1 && /一句/.test(crisis.directive), '危机时应该只一句', JSON.stringify(crisis))

// 被冒犯 → 短，最多两句
const off = decideSpeak({ tpj: { offense: 0.9 } })
ok(off.lines >= 1 && off.lines <= 2 && /短点/.test(off.directive), '被冒犯应该短', JSON.stringify(off))

// 暖 + 想要 → 可以两句
const warm = decideSpeak({ ofc: { warm: 0.8 }, str: { wanting: 0.6 } })
ok(warm.lines === 2 && /多说一句/.test(warm.directive), '暖的时候应该允许多说', JSON.stringify(warm))

// 累 → 一句
const tired = decideSpeak({ str: { stop: 0.8 } })
ok(tired.lines === 1 && /一句/.test(tired.directive), '累应该一句', JSON.stringify(tired))

// 平常 → 无指令（不额外说话）
const flat = decideSpeak({})
ok(flat.directive === null, '平常不该给指令', JSON.stringify(flat))
ok(flat.lines >= 1 && flat.lines <= 3, '平常行数应在 1~3', JSON.stringify(flat))

// 上限生效
const capped = decideSpeak({ ofc: { warm: 0.9 }, str: { wanting: 0.9 } }, { max: 1 })
ok(capped.lines === 1, '上限为 1 时不能给 2', JSON.stringify(capped))

// 非法输入不炸
const junk = decideSpeak({ str: { wanting: 'x' }, pcc: { crisis: NaN } })
ok(junk.lines >= 1, '脏数据也该给个值', JSON.stringify(junk))

if (fails.length) process.exit(1)
console.log('PASS 发言决策（危机/累→一句；被冒犯→短；暖→两句；平常无指令；上限生效；脏数据不炸）')
