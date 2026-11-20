// F06 升华：有火 + 手上有事，才会转成行动；缺一个都不成立
import { sublimate } from '../core/sublimate.js'

const fails = []
const ok = (c, m, d = '') => { if (!c) { fails.push(m + ' — ' + d); console.log('FAIL ' + m + (d ? ' — ' + d : '')) } }

// 没火：不升华
const calm = sublimate({}, { pending: [{ text: '写脚本' }] })
ok(calm.active === false && calm.because === 'no-fire', '没火不该升华', JSON.stringify(calm))

// 有火但手上没活：不硬凑
const idle = sublimate({ tpj: { offense: 0.9 } }, { pending: [] })
ok(idle.active === false && idle.because === 'nothing-to-do', '没活时不该升华', JSON.stringify(idle))

// 有火 + 有活：转成行动
const both = sublimate({ tpj: { offense: 0.9 } }, { pending: [{ text: '把脚本写完' }] })
ok(both.active === true && /去做|做完/.test(String(both.line)), '有火有活该转成行动', JSON.stringify(both))

// 边界：0.5 算有火
const edge = sublimate({ tpj: { offense: 0.5 } }, { pending: [{ text: 'x' }] })
ok(edge.active === true, '0.5 该算有火', JSON.stringify(edge))

// pending 不是数组：不许崩
const junk = sublimate({ tpj: { offense: 0.9 } }, { pending: 'x' })
ok(junk.active === false, '脏 pending 不该崩', JSON.stringify(junk))

if (fails.length) process.exit(1)
console.log('PASS 升华（没火不升 / 没活不凑 / 有火有活才转成行动 / 0.5 算有火 / 脏数据不崩）')
