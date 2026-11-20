import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
const TMP = mkdtempSync(join(tmpdir(), 'cortex-backfill-'))
process.env.CORTEX_DIR = TMP
const { CortexStore } = await import('../organs/cortex/lib/store.js')
let fail = 0
const ok = (c, m) => { if (!c) { fail++; console.log('FAIL', m) } else { console.log('  ok:', m) } }
const store = new CortexStore()
// 模拟历史数据：type 条目 + 三个同谓词实例，但 type 没有 supports
const a = store.put({ id: 'i1', kind: 'preference', subject: '主人', predicate: '讨厌', object: '香菜', text: 'x', evidenceCount: 1 })
const b = store.put({ id: 'i2', kind: 'preference', subject: '主人', predicate: '讨厌', object: '下雨', text: 'y', evidenceCount: 1 })
const t = store.put({ id: 't1', kind: 'preference', subject: '主人', predicate: '讨厌', object: '香菜、下雨', text: 'z', evidenceCount: 3 })
ok(t.level === 'type', `t1 应是 type（实际 ${t.level}）`)
delete t.supports   // 模拟"写入时还没有这段代码"
ok(!t.supports, '先把它清空，模拟历史数据')
const ids = await store.backfillSupports()
ok(ids.includes('t1'), `应回填 t1（实际 ${JSON.stringify(ids)}）`)
ok(Array.isArray(t.supports) && t.supports.length === 2, `supports 应有 2 条（实际 ${JSON.stringify(t.supports)}）`)
// 幂等：再跑一次不该有变化
const again = await store.backfillSupports()
ok(again.length === 0, `再跑一次不该重复回填（实际 ${again.length}）`)
// 没有同谓词实例的不挂
const lone = store.put({ id: 't2', kind: 'preference', subject: '主人', predicate: '喜欢', object: '雨天', text: 'w', evidenceCount: 3 })
const ids2 = await store.backfillSupports()
ok(!lone.supports, '没有实例支撑的不该挂空数组')
rmSync(TMP, { recursive: true, force: true })
console.log(fail ? `FAIL ${fail}` : 'PASS supports 回填（补历史 / 幂等 / 无实例不挂）')
process.exit(fail ? 1 : 0)
