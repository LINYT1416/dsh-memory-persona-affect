// 记忆→皮层 的巩固桥：写完的东西要能被蒸成事实，不是"有 episode 就算通"。
//
//   node tests/consolidate-bridge.mjs
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const root = mkdtempSync(join(tmpdir(), 'consol-'))
process.env.DSH_HOME = root
process.env.HIPPOCAMPUS_DIR = join(root, 'hippocampus')
// 皮层自己的目录叫 CORTEX_DIR，不跟 DSH_HOME 走；
// 不设它就会去读真实的 ~/.dsh/cortex，测试就是在真数据上跑。
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
  get: (n) => (n === 'tools' ? ctx.tools : n === 'webServer' ? ctx.webServer : n === 'agents' ? ctx.agents : services.get(n) || null),
  on: () => () => {},
  emit: () => true,
  effect: () => () => {},
  logger: { info() {}, warn() {}, error() {} },
}

const { apply } = await import('../index.js')
apply(ctx)
const hip = services.get('memory.hippocampus')
const cortex = services.get('memory.cortex')
ok(Boolean(hip), '没拿到 memory.hippocampus')
ok(Boolean(cortex), '没拿到 memory.cortex（皮层没接上）')

// 写两条会被记住的话：一条事实型，一条偏好型（皮层该抽出东西）
await hip.write({ role: 'user', text: '我叫示例用户，做机器人结构设计的，最近在找工作', session: 'c1', force: true })
await hip.write({ role: 'user', text: '我最讨厌别人骗我，宁可听难听的实话', session: 'c1', force: true })

const before = await cortex.stats()
const eps = await hip.episodes({ limit: 10 })
const rows = Array.isArray(eps) ? eps : (eps?.episodes || [])
ok(rows.length >= 1, `写了两条一条 episode 都没有（${rows.length}）`)

const settled = await hip.settle({ force: true })
ok(settled && typeof settled === 'object', `settle 返回异常：${JSON.stringify(settled)}`)

const closed = rows.filter((r) => r.state !== 'open').length
ok(closed >= 1, `关段之后还是 0 段可蒸（state 全是 open）`)

// 巩固：真跑一次（不是 dryRun）
const out = await hip.consolidate({ mode: 'shallow' })
ok(out && typeof out === 'object', `consolidate 返回异常：${JSON.stringify(out)?.slice(0, 160)}`)

const after = await cortex.stats()
const countOf = (st) => {
  if (!st) return 0
  const pick = st.facts ?? st.cells ?? st.cells?.length ?? st.counts?.facts
  return Number(typeof pick === 'object' ? pick?.length ?? 0 : pick ?? 0)
}
const b = countOf(before)
const a = countOf(after)
ok(a >= 1, `皮层里一条事实都没有：${JSON.stringify(after)?.slice(0, 200)}`)
ok(a >= b, `巩固之后事实反而少了：${b} → ${a}`)

// 再问一次皮层：刚写进去的偏好应该能被想起来（不是只有计数）
const ask = await cortex.ask('我最讨厌什么')
const askText = JSON.stringify(ask ?? '')
ok(askText.length > 2, '核心问题 cortex.ask 返回空了')
ok(/骗|实话|讨厌/.test(askText), `皮层答不出刚写的偏好：${askText.slice(0, 200)}`)

rmSync(root, { recursive: true, force: true })

if (fails.length) {
  console.log(`FAIL ${fails.length}:`)
  for (const f of fails) console.log(' - ' + f)
  process.exit(1)
}
console.log(`PASS 巩固桥（episode ${rows.length} 段 → 关段 ${closed} → 皮层事实 ${b}→${a}；ask 能答出偏好）`)
process.exit(0)
