// 补 exposed-but-untested 的那几个：recall / graph / traces / vectorReady / inject / distill / health
//
//   node tests/memory-tools3.mjs
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const root = mkdtempSync(join(tmpdir(), 'mt3-'))
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

await hip.write({ role: 'user', text: '明天想去海边走走，顺便吃个海鲜', session: 'a1' })
await hip.write({ role: 'user', text: '我叫示例用户，最近在找工作', session: 'a1' })

// ── 1. recall（异步检索口）───────────────────────────────
const r = await hip.recall('海边', { k: 5 })
const hits = Array.isArray(r) ? r : (r?.hits || [])
ok(hits.length >= 1, `recall('海边') 一条没回：${JSON.stringify(r)?.slice(0, 160)}`)
ok(JSON.stringify(hits).includes('海边'), `recall 回的条目里没有"海边"：${JSON.stringify(hits).slice(0, 200)}`)

// ── 2. graph：写过东西之后要有节点 ───────────────────────
const g = await hip.graph()
const nodes = g?.nodes ?? g?.cells ?? []
ok(Array.isArray(nodes) ? nodes.length >= 1 : Number(g?.size || 0) >= 1,
  `graph 是空的：${JSON.stringify(g)?.slice(0, 160)}`)

// ── 3. traces：检索过就该留下痕迹 ────────────────────────
const tr = await hip.traces()
const tCount = Number(tr?.total ?? tr?.count ?? (Array.isArray(tr) ? tr.length : 0))
ok(tCount >= 1, `recall 之后 traces 还是 0：${JSON.stringify(tr)?.slice(0, 160)}`)

// ── 4. vectorReady：得是个布尔（有没有向量是另一回事）────
const st0 = await hip.stats()
const vr = st0?.vectorReady
ok(typeof vr === 'boolean', `vectorReady 不是布尔：${JSON.stringify(vr)}`)

function hop(x) { return x && typeof x === 'object' && 'ready' in x ? x.ready : x }

// ── 5. cortex.inject：拼出来的提示词片段 ─────────────────
await hip.settle({ force: true })
await hip.consolidate({ mode: 'shallow' })
const inj = await cortex.inject({ query: '海边' })
const injText = typeof inj === 'string' ? inj : String(inj?.text ?? inj?.prompt ?? '')
ok(injText.length > 0, `cortex.inject 拼出来是空的：${JSON.stringify(inj)?.slice(0, 160)}`)

// ── 6. cortex.distill：dryRun 也要有可读的结果 ───────────
const dis = await cortex.distill({ dryRun: true })
ok(dis && typeof dis === 'object', `distill 返回异常：${JSON.stringify(dis)?.slice(0, 160)}`)

// ── 7. cortex.health：自检要报得出能不能写 ──────────────
const h = await cortex.health()
ok(h && typeof h === 'object', `health 返回异常：${JSON.stringify(h)?.slice(0, 160)}`)
const writable = h.writable ?? h.canWrite ?? h?.checks?.writable
ok(writable === undefined || typeof writable === 'boolean',
  `health.writable 既不是布尔也不是缺省：${JSON.stringify(writable)}`)

rmSync(root, { recursive: true, force: true })

if (fails.length) {
  console.log(`FAIL ${fails.length}:`)
  for (const f of fails) console.log(' - ' + f)
  process.exit(1)
}
console.log(`PASS 记忆工具三（recall ${hits.length} 条 / graph ${Array.isArray(nodes) ? nodes.length : 'obj'} / traces ${tCount} / inject ${injText.length} 字 / vectorReady ${vr}）`)
process.exit(0)
