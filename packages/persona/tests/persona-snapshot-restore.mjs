// 人格的快照/恢复：最容易做成"假恢复"——点头 true，参数没动。
// 这里要证明：走了几拍之后 restore，真的回到快照那一刻（ticks 回去、参数回去）。
//
//   node tests/persona-snapshot-restore.mjs
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const root = mkdtempSync(join(tmpdir(), 'persnap-'))
process.env.DSH_HOME = root
process.env.HIPPOCAMPUS_DIR = join(root, 'hippocampus')
process.env.CORTEX_DIR = join(root, 'cortex')

const fails = []
const ok = (c, m) => { if (!c) fails.push(m) }

const services = new Map()
const ctx = {
  systemPrompt: { context: () => () => {} },
  webServer: { register: () => () => {} },
  tools: { register: () => () => {}, get: () => null },
  agents: { list: () => [] },
  provide: (n, v) => services.set(n, v),
  set: (n, v) => services.set(n, v),
  get: (n) => services.get(n) || null,
  on: () => () => {},
  emit: () => true,
  effect: () => () => {},
  logger: { info() {}, warn() {}, error() {} },
}

const mod = await import('../index.js')
mod.apply(ctx)
await new Promise((r) => setTimeout(r, 300))
const per = services.get('memory.persona')

// ── 快照：有 schema、有拍数、参数都在 ─────────────────
const snap = per.snapshot()
ok(snap && typeof snap === 'object', 'snapshot 没返回对象')
ok(Number(snap.schema) >= 1, `快照没带 schema：${snap?.schema}`)
ok(Number.isFinite(Number(snap.ticks)), `快照没带 ticks：${snap?.ticks}`)
const metaCount = Object.keys(snap.meta || {}).length
ok(metaCount > 0, `快照的 meta 是空的（没有参数可恢复）`)

// ── 走五拍：拍数要涨 ───────────────────────────────────
const h0 = per.health()
for (let i = 0; i < 5; i++) per.tick('你行不行啊，这都做不好' + i)
const h1 = per.health()
ok(Number(h1.ticks) === Number(h0.ticks) + 5,
  `走五拍该涨 5：${h0.ticks} → ${h1.ticks}`)

// ── 恢复：真的回到那一刻 ───────────────────────────────
const ret = per.restore(snap)
ok(ret === true, `restore 没返回 true：${ret}`)
const h2 = per.health()
ok(Number(h2.ticks) === Number(snap.ticks),
  `恢复后 ticks 该回到 ${snap.ticks}，实际 ${h2.ticks}`)

// 参数逐项对比：不能只看"返回 true"
const paramsAfter = per.params()
let diff = 0
for (const [org, kv] of Object.entries(snap.meta || {})) {
  const [group, key] = org.split('.')
  const got = paramsAfter?.[group]?.[key]
  if (typeof kv?.value === 'number' && got !== kv.value) diff += 1
}
ok(diff === 0, `恢复后有 ${diff} 个参数没回去（快照 meta ${metaCount} 项）`)

// ── 坏输入：不许抛，也不许把状态搞坏 ───────────────────
let threw = null
try { per.restore(null) } catch (e) { threw = e }
ok(!threw, `restore(null) 不该抛：${threw?.message}`)
const h3 = per.health()
ok(Number(h3.ticks) === Number(h2.ticks), '坏输入把拍数改了')

rmSync(root, { recursive: true, force: true })

if (fails.length) {
  console.log(`FAIL ${fails.length}:`)
  for (const f of fails) console.log(' - ' + f)
  process.exit(1)
}
console.log(`PASS 人格快照/恢复（schema ${snap.schema}、参数 ${metaCount} 项；拍数 ${h0.ticks}→${h1.ticks}→恢复 ${h2.ticks}；参数全回去；restore(null) 不炸）`)
process.exit(0)
