// C08 资源预算：这一拍能分给几件事
import { speechBudget } from '../core/budget.js'

const fails = []
const ok = (c, m, d = '') => { if (!c) { fails.push(m + ' — ' + d); console.log('FAIL ' + m + (d ? ' — ' + d : '')) } }

// 平常：满额
const flat = speechBudget({}, 8)
ok(flat.capacity === 8, '平常该给满额', JSON.stringify(flat))

// 危机：砍掉一半
const crisis = speechBudget({ pcc: { crisis: 0.8 } }, 8)
ok(crisis.capacity <= 4, '危机时名额该砍到一半以下', JSON.stringify(crisis))
ok(crisis.why.includes('crisis-4'), '没记录削减原因', JSON.stringify(crisis))

// 被冒犯 + 累：叠加削减
const both = speechBudget({ tpj: { offense: 0.9 }, str: { stop: 0.9 } }, 8)
ok(both.capacity <= 4, '冒犯+累应该继续降', JSON.stringify(both))

// 但不能降到 0：至少留一句
const floor = speechBudget({ pcc: { crisis: 1 }, acc: { conflict: 1 }, tpj: { offense: 1 }, str: { stop: 1 }, mpfc: { esteem: 0 } }, 8)
ok(floor.capacity >= 1, '名额不能降到 0', JSON.stringify(floor))

// 暖 + 想要：允许加一格，但不超过 base+1
const warm = speechBudget({ str: { wanting: 0.9 }, ofc: { warm: 0.9 } }, 8)
ok(warm.capacity === 9, '暖的时候最多加一格', JSON.stringify(warm))

// 脏数据不炸
const junk = speechBudget({ pcc: { crisis: 'x' }, mpfc: { esteem: NaN } }, 6)
ok(Number.isFinite(junk.capacity) && junk.capacity >= 1, '脏数据也该给数', JSON.stringify(junk))

if (fails.length) process.exit(1)
console.log('PASS 资源预算（平常满额 / 危机砍半 / 叠加削减 / 保底一句 / 暖最多加一格 / 脏数据不炸）')
