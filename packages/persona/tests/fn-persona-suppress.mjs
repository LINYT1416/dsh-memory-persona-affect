// F01 压抑：有火不当场发作；跟熟人不必忍
import { suppress } from '../core/suppress.js'

const fails = []
const ok = (c, m, d = '') => { if (!c) { fails.push(m + ' — ' + d); console.log('FAIL ' + m + (d ? ' — ' + d : '')) } }

// 没情绪：不压
const calm = suppress({}, { intimacy: 0.2 })
ok(calm.active === false && calm.because === 'no-feeling', '没情绪不该压', JSON.stringify(calm))

// 有情绪 + 不熟：压
const cold = suppress({ tpj: { offense: 0.8 } }, { intimacy: 0.2 })
ok(cold.active === true && /忍住/.test(String(cold.directive)), '不熟时该压', JSON.stringify(cold))

// 内疚也算情绪
const guilt = suppress({ ofc: { guilt: 0.7 } }, { intimacy: 0.1 })
ok(guilt.active === true, '内疚也该压', JSON.stringify(guilt))

// 有情绪 + 很熟：不压
const close = suppress({ tpj: { offense: 0.9 } }, { intimacy: 0.9 })
ok(close.active === false && close.because === 'close-enough', '很熟不该压', JSON.stringify(close))

// 边界：正好 0.5 算熟
const edge = suppress({ tpj: { offense: 0.9 } }, { intimacy: 0.5 })
ok(edge.active === false, '0.5 该算熟', JSON.stringify(edge))

// 脏数据
const junk = suppress({ tpj: { offense: 'x' } }, { intimacy: null })
ok(junk.active === false, '脏数据不该压', JSON.stringify(junk))

if (fails.length) process.exit(1)
console.log('PASS 压抑（没情绪不压 / 不熟要压 / 内疚也压 / 很熟不压 / 0.5 算熟 / 脏数据不炸）')
