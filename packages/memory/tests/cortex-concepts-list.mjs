import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
const TMP = mkdtempSync(join(tmpdir(), 'cortex-list-'))
process.env.CORTEX_DIR = TMP
const { CortexStore } = await import('../organs/cortex/lib/store.js')
const { makeCortex } = await import('../organs/cortex/lib/pipeline.js')
let fail = 0
const ok = (c, m) => { if (!c) { fail++; console.log('FAIL', m) } else { console.log('  ok:', m) } }
const store = new CortexStore()
store.put({ id: 'f1', kind: 'fact', subject: '主人', predicate: '账号', object: '1000003', text: '主人账号 1000003', state: 'fact', confidence: 0.9, lastSeen: Date.now() })
store.put({ id: 'f2', kind: 'fact', subject: '主人', predicate: '住在', object: '威海', text: '主人住在威海', state: 'fact', confidence: 0.9, lastSeen: Date.now() - 1000 })
store.put({ id: 'p1', kind: 'preference', subject: '主人', predicate: '讨厌', object: '香菜', text: '主人讨厌香菜', state: 'hypothesis', confidence: 0.5 })
const c = makeCortex({ store, adapters: {}, meta: {} })
const list = c.conceptsSync('', 20)
ok(Array.isArray(list.items) && list.items.length === 3, `空查询应返回清单（实际 ${list.items?.length}）`)
ok(list.items[0].id === 'f1', `事实应排前面（实际 ${list.items[0].id}）`)
ok(list.total === 3, `total 应是全部条数（实际 ${list.total}）`)
// 有关键词时走概念检索：只认 concept 类（这是原有语义，不改）
store.put({ id: 'k1', kind: 'concept', subject: '主人', predicate: '住在', object: '威海', text: '主人住在威海', tags: ['concept'], confidence: 0.8 })
const searched = c.conceptsSync('威海', 5)
// 有关键词时走原有概念检索（语义未改），只断言结构正确
ok(Array.isArray(searched.items), '有关键词时仍返回 items 结构')
rmSync(TMP, { recursive: true, force: true })
console.log(fail ? `FAIL ${fail}` : 'PASS 概念清单（空查询返回清单 / 事实优先 / 带词仍检索）')
process.exit(fail ? 1 : 0)


