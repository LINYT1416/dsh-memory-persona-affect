// 抽象层级落库自检。
// 重要：必须在 import store 之前把 CORTEX_DIR 指到临时目录，否则 persist 会写进生产 cells.jsonl。
// （之前就是没隔离，跑测试时往真库塞了 a1..a6 这些假 cell。）
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const TMP = mkdtempSync(join(tmpdir(), 'cortex-levels-'))
process.env.CORTEX_DIR = TMP

const { CortexStore } = await import('../organs/cortex/lib/store.js')
const { levelOf, LEVELS } = await import('../organs/cortex/lib/levels.js')

let fail = 0
const ok = (c, m) => { if (!c) { fail++; console.log('FAIL', m) } else { console.log('  ok:', m) } }

const store = new CortexStore()

const fact = store.put({ id: 'a1', text: '她住在威海', kind: 'fact', subject: '她', predicate: '住在', object: '威海', confidence: 0.8, evidenceCount: 1 })
ok(fact.level === 'instance', `单证据事实应为 instance（实际 ${fact.level}）`)

const rel = store.put({ id: 'a2', text: '她和妈妈关系好', kind: 'relation', subject: '她', predicate: '关系', object: '妈妈', confidence: 0.8, evidenceCount: 1 })
ok(rel.level === 'type', `关系应为 type（实际 ${rel.level}）`)

const pref = store.put({ id: 'a3', text: '她喜欢雨天', kind: 'preference', subject: '她', predicate: '喜欢', object: '雨天', confidence: 0.8, evidenceCount: 3 })
ok(pref.level === 'type', `证据 3 条的偏好应为 type（实际 ${pref.level}）`)

const rule = store.put({ id: 'a4', text: '她周末常睡到中午', kind: 'fact', subject: '她', predicate: '习惯', object: '周末晚起', confidence: 0.8, evidenceCount: 5 })
ok(rule.level === 'rule', `证据 5 条应为 rule（实际 ${rule.level}）`)

const levels = store.allCells().map((c) => c.level)
ok(levels.includes('instance') && levels.includes('type') && levels.includes('rule'), `三层都应出现（实际 ${JSON.stringify(levels)}）`)
ok(levels.every((l) => LEVELS.includes(l)), `level 只能是 ${LEVELS.join('/')}`)

const kept = store.put({ id: 'a5', text: '旧数据', kind: 'fact', evidenceCount: 1, level: 'rule' })
ok(kept.level === 'rule', '已有 level 不该被覆盖')

let threw = null
try { store.put({ id: 'a6' }) } catch (e) { threw = e }
ok(!threw, '缺字段不该抛错')
ok(store.allCells().every((c) => typeof c.level === 'string'), '每条 cell 都该有 level')

ok(levelOf({ kind: 'relation' }) === 'type', 'levelOf 关系规则一致')
ok(levelOf({ kind: 'fact', evidenceCount: 5 }) === 'rule', 'levelOf 规律规则一致')

// 关键：生产目录没被动过
ok(TMP !== 'C:\\Users\\64091\\.dsh\\cortex' && TMP.startsWith(tmpdir()), '测试跑在临时目录')

rmSync(TMP, { recursive: true, force: true })
console.log(fail ? `FAIL ${fail}` : 'PASS 抽象层级落库（含数据隔离：临时目录，不写生产）')
process.exit(fail ? 1 : 0)
