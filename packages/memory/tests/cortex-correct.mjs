// 纠错与撤销：说"记错了"要真的搜不到，说"撤销"要真的搜得回来。
//
// 以前 restore() 只清 archived，不清 retracted —— 接口返回 {restored:true}，
// 实际那条还是 retracted，检索永远搜不到。等于"撤销"是句空话。
//
//   node tests/cortex-correct.mjs
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const root = mkdtempSync(join(tmpdir(), 'correct-'))
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

await hip.write({ role: 'user', text: '我叫示例用户，做机器人结构设计的', session: 'c1', force: true })
await hip.settle({ force: true })
await hip.consolidate({ mode: 'shallow' })

const before = (await cortex.search('名字')).hits || []
ok(before.length >= 1, `前置条件不成立：一条事实都没抽出来`)
const id = before[0].cellId

// ── 1. 纠错：搜不到 ─────────────────────────────────────
const fixed = await cortex.correct(id, { reason: '说错了' })
ok(fixed?.retracted === true, `correct 没标 retracted：${JSON.stringify(fixed)?.slice(0, 140)}`)
const mid = (await cortex.search('名字')).hits || []
ok(mid.length === 0, `纠错之后还能搜到：${JSON.stringify(mid)?.slice(0, 160)}`)

// ── 2. 撤销纠错：要能搜回来 ─────────────────────────────
const back = await cortex.restore(id)
ok(back?.restored === true, `restore 返回异常：${JSON.stringify(back)?.slice(0, 140)}`)
const after = (await cortex.search('名字')).hits || []
ok(after.length >= 1, `restore 说恢复了，但检索还是空——假恢复`)

rmSync(root, { recursive: true, force: true })

if (fails.length) {
  console.log(`FAIL ${fails.length}:`)
  for (const f of fails) console.log(' - ' + f)
  process.exit(1)
}
console.log(`PASS 纠错（纠错前 ${before.length} 条 → 纠错后 ${mid.length} 条 → 撤销后 ${after.length} 条）`)
process.exit(0)
