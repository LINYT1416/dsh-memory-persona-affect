// F02 合理化：没做成的事要有个说法；没失败过就不许编理由
import { attribute } from '../core/blame.js'

const fails = []
const ok = (c, m, d = '') => { if (!c) { fails.push(m + ' — ' + d); console.log('FAIL ' + m + (d ? ' — ' + d : '')) } }

// 一件都没黄：不许编
const none = attribute({ done: 3, failed: 0 }, { str: { stop: 0.9 } })
ok(none.line === null && none.because === 'nothing-failed', '没失败过不该合理化', JSON.stringify(none))

// 黄了 + 累：往外面推
const ext = attribute({ done: 1, failed: 2 }, { str: { stop: 0.7 } })
ok(ext.target === 'external' && /事太多/.test(String(ext.line)), '累时该怪外面', JSON.stringify(ext))

// 黄了 + 心虚：也往外面推
const guilt = attribute({ done: 1, failed: 1 }, { ofc: { guilt: 0.6 } })
ok(guilt.target === 'external', '心虚时也该怪外面', JSON.stringify(guilt))

// 黄了 + 自尊低：往自己身上揽
const internal = attribute({ done: 1, failed: 1 }, { mpfc: { esteem: 0.2 } })
ok(internal.target === 'internal' && /我不行/.test(String(internal.line)), '低自尊该往自己身上揽', JSON.stringify(internal))

// 低自尊优先于累：同一个人不能既怪外面又怪自己
const both = attribute({ done: 0, failed: 1 }, { mpfc: { esteem: 0.2 }, str: { stop: 0.9 } })
ok(both.target === 'internal', '两种条件都在时只能选一个方向', JSON.stringify(both))

// 黄了但没有任何由头：不硬编
const plain = attribute({ done: 2, failed: 1 }, {})
ok(plain.line === null && plain.because === 'no-cue', '没由头不该硬编', JSON.stringify(plain))

// 脏数据
const junk = attribute({ failed: 'x' }, { mpfc: { esteem: NaN }, str: { stop: NaN } })
ok(junk.line === null, '脏数据不该合理化', JSON.stringify(junk))

if (fails.length) process.exit(1)
console.log('PASS 合理化（没失败不编 / 累或心虚→怪外面 / 低自尊→揽自己 / 两种都在只选一个方向 / 无由头不硬编）')
