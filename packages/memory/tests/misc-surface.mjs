// 剩下这些零散口：海马体的值属性、前额叶的不变量自检、皮层的只读声明与冲突自检。
//
// 这几种最容易"假装有"：
//   · vectorReady 必须是布尔且说真话（这个环境没有向量 → false）
//   · ingest 必须明说"皮层不收消息"，而不是回一句 ok 让人以为收了
//   · conflictProbe 是自检，跑完不许在冲突队列里留垃圾
//
//   node tests/misc-surface.mjs
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const root = mkdtempSync(join(tmpdir(), 'misc-'))
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
const cx = services.get('memory.cortex')
const pfc = services.get('memory.prefrontal')
await cx.whenReady()

// ── 海马体的值属性：版本是字符串、向量是布尔且说真话 ──
ok(typeof hip.version === 'string' && hip.version.length > 0, `version 不对：${JSON.stringify(hip.version)}`)
ok(typeof hip.vectorReady === 'boolean', `vectorReady 不是布尔：${typeof hip.vectorReady}`)
ok(hip.vectorReady === false, `这个环境没有向量，vectorReady 不该是 true：${hip.vectorReady}`)

const layers = hip.layers.list()
ok(Array.isArray(layers) && layers.length === 5, `分层不对：${JSON.stringify(layers)}`)
ok(layers.every((x) => x.on === true), `默认该全开：${JSON.stringify(layers)}`)

// ── 前额叶不变量自检：能跑、能报 ──────────────────────
const inv = pfc.invariants.noContent()
ok(inv && typeof inv === 'object', `noContent 没返回对象：${JSON.stringify(inv)}`)
ok(typeof inv.ok === 'boolean', `noContent 没给 ok：${JSON.stringify(inv)}`)
ok(Array.isArray(inv.bad), `noContent.bad 不是数组：${JSON.stringify(inv)}`)
ok(Number.isFinite(Number(inv.inputs)), `noContent 没记检查了几条：${JSON.stringify(inv)}`)

// ── 皮层：只读声明要说清 ─────────────────────────────
const ing = await cx.ingest()
ok(ing && ing.ok === true, `ingest 没回 ok：${JSON.stringify(ing)}`)
ok(/只读|不收|read.?only/i.test(String(ing.note || '')),
  `ingest 没说明皮层不直接收消息：${JSON.stringify(ing)}`)

// ── 冲突自检：能造出冲突，且不留垃圾 ─────────────────
const before = (await cx.conflicts()) || []
const probe = await cx.conflictProbe()
ok(probe && probe.ok === true, `conflictProbe 没成功：${JSON.stringify(probe)}`)
ok(probe.kind === 'conflict', `自检没造出冲突：${JSON.stringify(probe)}`)
ok(String(probe.aId || '').length > 0 && String(probe.bId || '').length > 0,
  `自检没给出两条 id：${JSON.stringify(probe)}`)

await new Promise((r) => setTimeout(r, 150))
const after = (await cx.conflicts()) || []
ok(after.length <= before.length + 0,
  `自检在冲突队列里留了 ${after.length - before.length} 条垃圾（自称会归档）`)

rmSync(root, { recursive: true, force: true })

if (fails.length) {
  console.log(`FAIL ${fails.length}:`)
  for (const f of fails) console.log(' - ' + f)
  process.exit(1)
}
console.log(`PASS 零散口（海马 ${hip.version}、vectorReady=${hip.vectorReady}、${layers.length} 层全开；不变量自检 ok=${inv.ok}；ingest 声明只读；自检造冲突 ${probe.kind} 且不留队列垃圾）`)
process.exit(0)
