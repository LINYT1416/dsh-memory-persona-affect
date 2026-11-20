// R04 角色：只由关系远近决定，不是随机换脸
import { roleOf } from '../core/role.js'

const fails = []
const ok = (c, m, d = '') => { if (!c) { fails.push(m + ' — ' + d); console.log('FAIL ' + m + (d ? ' — ' + d : '')) } }

// 陌生人：客气
const stranger = roleOf({ intimacy: 0.1, turns: 3 })
ok(stranger.role === 'stranger' && /客气/.test(String(stranger.directive)), '刚认识该客气', JSON.stringify(stranger))

// 亲密度够但只聊过几轮：还是客气（聊得少不算熟）
const fewTurns = roleOf({ intimacy: 0.9, turns: 4 })
ok(fewTurns.role === 'stranger', '聊得太少不该当熟人', JSON.stringify(fewTurns))

// 中间：不给指令（不端着，也别太黏）
const mid = roleOf({ intimacy: 0.5, turns: 50 })
ok(mid.role === 'acquaintance' && mid.directive === null, '中间不该给指令', JSON.stringify(mid))

// 很熟：不用端着
const close = roleOf({ intimacy: 0.9, turns: 200 })
ok(close.role === 'close' && /不用客气/.test(String(close.directive)), '很熟该随意', JSON.stringify(close))

// 边界：0.7 算熟
const edge = roleOf({ intimacy: 0.7, turns: 100 })
ok(edge.role === 'close', '0.7 该算很熟', JSON.stringify(edge))

// 三种角色互不重叠
const roles = new Set([stranger.role, mid.role, close.role])
ok(roles.size === 3, '三种角色应各不相同', [...roles].join(','))

// 脏数据
const junk = roleOf({ intimacy: 'x', turns: NaN })
ok(junk.role === 'stranger', '脏数据当陌生人', JSON.stringify(junk))

if (fails.length) process.exit(1)
console.log('PASS 角色（刚认识客气 / 聊得少不算熟 / 中间不给指令 / 很熟随意 / 0.7 算熟 / 三档不同 / 脏数据当陌生）')
