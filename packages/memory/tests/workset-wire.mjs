// 接线验证：工作集压缩真的进了 system prompt，而且被压掉的细节还能召回。
//   node tests/workset-wire.mjs
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const root = mkdtempSync(join(tmpdir(), 'wsw-'))
process.env.DSH_HOME = root
process.env.HIPPOCAMPUS_DIR = join(root, 'hippocampus')
process.env.CORTEX_DIR = join(root, 'cortex')
process.env.AMYGDALA_DIR = join(root, 'amygdala')

const fails = []
const ok = (c, m) => { if (!c) fails.push(m) }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const services = new Map()
const handlers = new Map()
const injected = new Map() // name -> text()
const listen = (n, f) => { if (!handlers.has(n)) handlers.set(n, []); handlers.get(n).push(f); return () => {} }
const emit = (n, p) => { for (const f of handlers.get(n) || []) { try { f(p) } catch { /* 忽略 */ } } return true }

const agents = []
const routes = []
const ctx = {
  systemPrompt: { context: () => () => {} },
  webServer: { register: (r) => { routes.push(r); return () => {} } },
  tools: { register: () => () => {}, get: () => null },
  provide: (n, v) => services.set(n, v),
  set: (n, v) => services.set(n, v),
  get: (n) => (n === 'agents' ? { list: () => agents } : services.get(n) || null),
  agents: { list: () => agents },
  on: listen,
  emit,
  effect: () => () => {},
  logger: { info() {}, warn() {}, error() {} },
}

const { apply } = await import('../index.js')
await apply(ctx)
const hip = services.get('memory.hippocampus')
const cx = services.get('memory.cortex')
await (cx?.whenReady?.() ?? Promise.resolve())

// 写 30 轮，第 2 轮埋关键细节
await hip.write({ role: 'user', text: '我下周三要去面结构设计岗，记得带上 SolidWorks 图纸和成绩单。', session: 'w1', force: true })
for (let i = 0; i < 28; i += 1) {
  await hip.write({ role: i % 2 ? 'assistant' : 'user', text: `第${i}步：改了参数、跑了测试，都过了。`, session: 'w1', force: true })
}
await hip.settle({ force: true })

// 现在才"接入"一个 agent，触发 mount → 注入工作集
const agentCtx = {
  systemPrompt: {
    context: ({ name, text }) => { injected.set(name, text); return () => {} },
  },
  on: () => () => {},
  effect: () => () => {},
  tools: { register: () => () => {}, get: () => null },
}
agents.push({ id: 'agent-1', ctx: agentCtx })
emit('agent/created', { agent: agents[0] })
await sleep(300)
// 写完记忆之后来一轮 inbox：工作集要在这一拍重算（线上就是这条路径）
emit('agent/inbox/inserted', { message: { content: '继续' } })
await sleep(700)

const getText = () => {
  const fn = injected.get('memory-workset')
  return typeof fn === 'function' ? String(fn() || '') : ''
}

const text = getText()
ok(injected.has('memory-workset'), '没有注册 memory-workset 注入')
ok(text.length > 0, '工作集是空的')
ok(/工作记忆|现在在做|还没做完|能回取的细节/.test(text), `工作集没有结构：${text.slice(0, 80)}`)
ok(text.includes('结构设计') || text.includes('图纸'), `关键细节没进工作集：${text.slice(0, 160)}`)
ok(text.length < 4000, `工作集太长了：${text.length} 字`)

// 被压掉的细节仍然能召回（压缩只压"进上下文的字"，不压记忆）
const back = await hip.recall('结构设计 面试', { k: 3 })
const hit = (back?.hits || []).some((h) => String(h.summary || '').includes('结构设计'))
ok(hit, `压缩之后细节召不回来了：${JSON.stringify((back?.hits || []).map((h) => String(h.summary).slice(0, 20)))}`)

// 只读路由：外部能直接看到"这一轮记住了什么"
const route = routes.find((r) => String(r.path) === '/memory/workset')
ok(Boolean(route), '没有注册 /memory/workset 路由')
if (route) {
  const out = await new Promise((resolve) => {
    const req = { url: '/memory/workset', query: {} }
    const res = { statusCode: 200, setHeader() {}, end(t) { resolve(t) } }
    void route.handler(req, res)
  })
  const j = JSON.parse(out)
  ok(j.ok === true, '路由返回不 ok')
  ok(String(j.text || '').includes('工作记忆'), `路由里的工作集不对：${String(j.text).slice(0, 60)}`)
  ok(j.last && j.last.tokens > 0, `路由没有报出 token 数：${JSON.stringify(j.last)}`)
  ok(String(j.text).includes('图纸') || String(j.text).includes('结构设计'), '路由里看不到关键细节')
}

rmSync(root, { recursive: true, force: true })

if (fails.length) {
  console.log(`FAIL ${fails.length}:`)
  for (const f of fails) console.log(' - ' + f)
  process.exit(1)
}
console.log(`PASS 工作集接线（注入 ${text.length} 字；关键细节在上下文里也能召回）`)
process.exit(0)
