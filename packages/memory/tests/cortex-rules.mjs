// 规律层（第四层）自检：跨天反复出现才升；稳定 id 不繁殖；不拿 pattern 当原料。
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const TMP = mkdtempSync(join(tmpdir(), 'cortex-rules-'))
process.env.CORTEX_DIR = TMP

const { findRules } = await import('../organs/cortex/lib/commonality.js')

let fail = 0
const ok = (c, m) => { if (!c) { fail++; console.log('FAIL', m) } else { console.log('  ok:', m) } }

const DAY = 86400000
const T0 = Date.UTC(2026, 10, 1)
const cell = (over = {}) => ({
  id: 'c' + Math.random().toString(36).slice(2, 8),
  subject: '主人', predicate: '讨厌', object: '香菜', kind: 'preference',
  lastSeen: T0, firstSeen: T0, supportIds: ['ep1'], ...over,
})

// 1) 同一天出现三次：不是规律
const sameDay = [cell({ lastSeen: T0 }), cell({ lastSeen: T0 + 1000 }), cell({ lastSeen: T0 + 2000 })]
ok(findRules(sameDay).length === 0, '同一天内重复不算规律')

// 2) 三天各一次：升成规律
const threeDays = [cell({ lastSeen: T0 }), cell({ lastSeen: T0 + DAY }), cell({ lastSeen: T0 + 2 * DAY })]
const r = findRules(threeDays)
ok(r.length === 1, `三天应升 1 条（实际 ${r.length}）`)
ok(r[0].level === 'rule', 'level 应为 rule')
ok(r[0].id.startsWith('rule_'), 'id 应为稳定前缀 rule_')
ok((r[0].supports || []).length === 3, '应记下三条支撑')

// 3) 稳定 id：重算不会产生新 id
const again = findRules(threeDays)
ok(again[0].id === r[0].id, '重算 id 应一致（不繁殖）')

// 4) 只隔一天（span 不够）不升
const shortSpan = [cell({ lastSeen: T0 }), cell({ lastSeen: T0 + DAY }), cell({ lastSeen: T0 + DAY + 1000 })]
ok(findRules(shortSpan).length === 0, '跨度不足 2 天不该升')

// 5) 已经升出来的 pattern/concept 不能再当原料
const withRule = [...threeDays, { ...r[0], kind: 'concept', tags: ['pattern', 'rule'] }]
ok(findRules(withRule).length === 1, `规律不该自我繁殖（实际 ${findRules(withRule).length}）`)

// 6) 一次性的事不算规律
const transient = [
  cell({ predicate: '正在做', object: '写代码', lastSeen: T0 }),
  cell({ predicate: '正在做', object: '写代码', lastSeen: T0 + DAY }),
  cell({ predicate: '正在做', object: '写代码', lastSeen: T0 + 2 * DAY }),
]
ok(findRules(transient).length === 0, '“正在做”不该升成规律')

// 7) 不同对象不会被混成一条
const mixed = [
  cell({ object: '香菜', lastSeen: T0 }),
  cell({ object: '香菜', lastSeen: T0 + DAY }),
  cell({ object: '香菜', lastSeen: T0 + 2 * DAY }),
  cell({ object: '下雨', lastSeen: T0 }),
  cell({ object: '下雨', lastSeen: T0 + DAY }),
  cell({ object: '下雨', lastSeen: T0 + 2 * DAY }),
]
const m = findRules(mixed)
ok(m.length === 2, `两个不同规律应各一条（实际 ${m.length}）`)
ok(m.every((x) => x.object === '香菜' || x.object === '下雨'), 'object 应保持单一')

rmSync(TMP, { recursive: true, force: true })
console.log(fail ? `FAIL ${fail}` : 'PASS 规律层（跨天/稳定 id/不繁殖/跨度/一次性排除/不混对象）')
process.exit(fail ? 1 : 0)
