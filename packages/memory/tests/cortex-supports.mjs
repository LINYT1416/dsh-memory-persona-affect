import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
const TMP = mkdtempSync(join(tmpdir(), 'cortex-supports-'))
process.env.CORTEX_DIR = TMP
const { CortexStore } = await import('../organs/cortex/lib/store.js')
let fail = 0
const ok = (c, m) => { if (!c) { fail++; console.log('FAIL', m) } else { console.log('  ok:', m) } }
const store = new CortexStore()
// 三个具体实例
const a = store.put({ id: 'i1', kind: 'preference', subject: '主人', predicate: '讨厌', object: '香菜', text: '主人讨厌香菜', evidenceCount: 1 })
const b = store.put({ id: 'i2', kind: 'preference', subject: '主人', predicate: '讨厌', object: '下雨', text: '主人讨厌下雨', evidenceCount: 1 })
// 抽象层（证据 3 条 → type）
const t = store.put({ id: 't1', kind: 'preference', subject: '主人', predicate: '讨厌', object: '香菜、下雨', text: '主人讨厌香菜、下雨', evidenceCount: 3 })
ok(a.level === 'instance' && b.level === 'instance', '具体实例应为 instance')
ok(t.level === 'type', `抽象层应为 type（实际 ${t.level}）`)
ok(Array.isArray(t.supports) && t.supports.length === 2, `抽象层应记下支撑它的实例（实际 ${JSON.stringify(t.supports)}）`)
ok(t.supports.includes('i1') && t.supports.includes('i2'), '应指到具体两条')
// 不该跨谓词乱连
const other = store.put({ id: 't2', kind: 'preference', subject: '主人', predicate: '喜欢', object: '雨天', text: '主人喜欢雨天', evidenceCount: 3 })
ok(!other.supports, '没有同谓词实例时不该挂支撑')
rmSync(TMP, { recursive: true, force: true })
console.log(fail ? `FAIL ${fail}` : 'PASS 双向支撑（type 记下 instance / 不跨谓词）')
process.exit(fail ? 1 : 0)
