// 记忆仪表页：页面能开、数据是真的（这一轮 / 最近 / 长期 / 永久）。
//   node tests/memory-page.mjs
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const root = mkdtempSync(join(tmpdir(), 'mp-'))
process.env.DSH_HOME = root
process.env.HIPPOCAMPUS_DIR = join(root, 'hippocampus')
process.env.CORTEX_DIR = join(root, 'cortex')
process.env.AMYGDALA_DIR = join(root, 'amygdala')

const fails = []
const ok = (c, m) => { if (!c) fails.push(m) }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const services = new Map()
const handlers = new Map()
const routes = new Map()
const listen = (n, f) => { if (!handlers.has(n)) handlers.set(n, []); handlers.get(n).push(f); return () => {} }
const emit = (n, p) => { for (const f of handlers.get(n) || []) { try { void f(p) } catch { /* 忽略 */ } } return true }
const agents = []
const ctx = {
  systemPrompt: { context: () => () => {} },
  webServer: { register: (r) => { routes.set(String(r.path), r); return () => {} } },
  tools: { register: () => () => {}, get: () => null },
  provide: (n, v) => services.set(n, v),
  set: (n, v) => services.set(n, v),
  get: (n) => (n === 'agents' ? { list: () => agents } : services.get(n) || null),
  agents: { list: () => agents },
  on: listen, emit, effect: () => () => {},
  logger: { info() {}, warn() {}, error() {} },
}

const { apply } = await import('../index.js')
await apply(ctx)
const hip = services.get('memory.hippocampus')
const cx = services.get('memory.cortex')
await (cx?.whenReady?.() ?? Promise.resolve())

// 灌一点真数据
await hip.write({ role: 'user', text: '我对芒果过敏，别给我买芒果味的。', session: 'm1', force: true })
await hip.write({ role: 'user', text: '我下周三要去面结构设计岗，带上图纸。', session: 'm1', force: true })
await hip.settle({ force: true })

// 接一个 agent 触发工作集
const injected = new Map()
const agentHandlers = new Map()
const agent = {
  id: 'm1',
  ctx: {
    systemPrompt: { context: (x) => { injected.set(x.name, x); return () => {} } },
    on: (n, f) => { if (!agentHandlers.has(n)) agentHandlers.set(n, []); agentHandlers.get(n).push(f); return () => {} },
    effect: () => () => {},
    tools: { register: () => () => {} },
  },
}
agents.push(agent)
emit('agent/created', { agent })
await sleep(300)
for (const f of agentHandlers.get('agent/inbox/inserted') || []) { void f({ message: { content: '我想吃甜品' } }) }
await sleep(1500)

const call = async (path) => new Promise((resolve) => {
  const r = routes.get(path)
  if (!r) return resolve(null)
  const req = { url: path, query: {} }
  const res = { statusCode: 200, headers: {}, setHeader(k, v) { this.headers[k] = v }, end(t) { resolve(t) } }
  void r.handler(req, res)
})

const page = await call('/memory')
ok(typeof page === 'string' && page.includes('这一轮记住的'), '页面没渲染出来')

const raw = await call('/memory/data')
ok(typeof raw === 'string', '/memory/data 没响应')
const j = JSON.parse(raw || '{}')
ok(j.ok === true, `数据不 ok：${JSON.stringify(j.errors)}`)
ok(j.recent.length > 0, '最近记住的是空的')
ok(j.recent.some((x) => String(x.summary).includes('芒果')), `最近里找不到刚写的那句：${JSON.stringify(j.recent.slice(0, 2))}`)
ok(j.workset && Number(j.workset.tokens) > 0, `这一轮没有工作集：${JSON.stringify(j.workset)}`)
ok(String(j.workset.text || '').length > 0, '工作集是空的')
// 长期/永久可能真空（皮层还没蒸馏）——但字段必须在，且计数来自真实服务
ok(Array.isArray(j.facts) && Array.isArray(j.permanent), '长期/永久字段缺失')
ok(j.cortex && j.cortex.facts !== undefined, `皮层没给统计：${JSON.stringify(j.cortex)}`)

rmSync(root, { recursive: true, force: true })

if (fails.length) {
  console.log(`FAIL ${fails.length}:`)
  for (const f of fails) console.log(' - ' + f)
  process.exit(1)
}
console.log(`PASS 记忆仪表页（页面开 / 最近 ${j.recent.length} 条 / 工作集 ${j.workset.tokens} token / 皮层统计 ${JSON.stringify(j.cortex)}）`)
process.exit(0)
