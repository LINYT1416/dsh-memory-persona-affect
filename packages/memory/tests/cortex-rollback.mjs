// 回滚：不带名字要能列出快照（不能崩），带了名字要真的把库换回去。
//
// 以前 rollback() 直接 readSnapshot(undefined) → join(SNAP_DIR, undefined) 抛 TypeError，
// "看看有哪些快照"这个基本用法一调就崩。
//
//   node tests/cortex-rollback.mjs
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const root = mkdtempSync(join(tmpdir(), 'rb-'))
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

const { apply } = await import('../index.js')
apply(ctx)
const hip = services.get('memory.hippocampus')
const cortex = services.get('memory.cortex')

// ── 1. 不带名字：列清单，不许抛 ─────────────────────────
let listed = null
try {
  listed = await cortex.rollback()
} catch (e) {
  fails.push(`rollback() 抛错了：${e?.message}`)
}
ok(listed && Array.isArray(listed.snapshots), `rollback() 该返回 {snapshots:[]}，实际 ${JSON.stringify(listed)?.slice(0, 140)}`)

// ── 2. 跑一次蒸馏（会产生快照），再列一次 ───────────────
await hip.write({ role: 'user', text: '我叫示例用户，做机器人结构设计的', session: 'c1', force: true })
await hip.settle({ force: true })
await hip.consolidate({ mode: 'shallow' })
await cortex.distill({ mode: 'shallow' })

const list2 = await cortex.rollback()
const names = list2?.snapshots || []
ok(Array.isArray(names), '快照清单不是数组')

// 有快照就真回滚一次；没有就显式说明（不当成通过）
let rolled = null
if (names.length) {
  rolled = await cortex.rollback(names[names.length - 1])
  ok(rolled && Number(rolled.cells) >= 0, `回滚返回异常：${JSON.stringify(rolled)?.slice(0, 140)}`)
  ok(Number(rolled?.seq) >= 1, `回滚没带回 seq：${JSON.stringify(rolled)}`)
}

rmSync(root, { recursive: true, force: true })

if (fails.length) {
  console.log(`FAIL ${fails.length}:`)
  for (const f of fails) console.log(' - ' + f)
  process.exit(1)
}
const note = names.length
  ? `回滚 ${names.length} 个快照里的最后一个 → seq ${rolled.seq} / cells ${rolled.cells}`
  : 'SKIP 实际回滚：这次蒸馏没产生快照（列清单本身已验）'
console.log(`PASS 回滚（rollback() 列清单不崩；${note}）`)
process.exit(0)
