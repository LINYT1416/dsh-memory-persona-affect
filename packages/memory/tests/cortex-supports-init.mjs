// 加载兜底：put() 加载时会算出 supports，但 persist:false 不落盘。
// 以前的表现是"内存里有、文件里没有"，重启后重算一遍，supports 永远补不上。
// 这个测试盯着：init 必须把算出来的 supports 写回磁盘，而且第二次 init 不许重复写。
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const TMP = mkdtempSync(join(tmpdir(), 'cortex-supports-init-'))
process.env.CORTEX_DIR = TMP

const { FILES, CortexStore } = await import('../organs/cortex/lib/store.js')

let fail = 0
const ok = (c, m) => { if (!c) { fail++; console.log('FAIL', m) } else { console.log('  ok:', m) } }

// 造一份"历史数据"：三个同谓词实例 + 一条没有 supports 的 rule
const now = Date.now()
const rows = [
  { id: 'i1', kind: 'preference', subject: '主人', predicate: '讨厌', object: '香菜', text: '主人讨厌香菜', level: 'instance', confidence: 0.9, lastSeen: now },
  { id: 'i2', kind: 'preference', subject: '主人', predicate: '讨厌', object: '下雨', text: '主人讨厌下雨', level: 'instance', confidence: 0.9, lastSeen: now },
  { id: 'r1', kind: 'preference', subject: '主人', predicate: '讨厌', object: '香菜、下雨', text: '主人讨厌：香菜、下雨', level: 'rule', confidence: 0.9, lastSeen: now, supports: [] },
]
writeFileSync(FILES.cells, rows.map((r) => JSON.stringify(r)).join('\n') + '\n', 'utf8')

const store = new CortexStore()
await store.init()
ok(store.supportBackfilled >= 1, `init 应该补写至少 1 条（实际 ${store.supportBackfilled}）`)

const after = readFileSync(FILES.cells, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l))
const persisted = after.filter((r) => r.id === 'r1' && Array.isArray(r.supports) && r.supports.length)
ok(persisted.length >= 1, `磁盘上应该出现带 supports 的 r1（实际 ${persisted.length} 条）`)
ok(persisted[0]?.supports?.length === 2, `supports 应该是 2 条（实际 ${persisted[0]?.supports?.length}）`)

// 幂等：新实例再 init 一次，不该再写
const store2 = new CortexStore()
await store2.init()
ok(store2.supportBackfilled === 0, `第二次 init 不该重复写（实际 ${store2.supportBackfilled}）`)

rmSync(TMP, { recursive: true, force: true })
console.log(fail ? `FAIL ${fail}` : 'PASS supports 加载兜底（算出来就落盘 / 幂等）')
process.exit(fail ? 1 : 0)
