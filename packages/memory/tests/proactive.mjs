// 主动想起：该冒的时候冒，不该冒的时候闭嘴。
//   node tests/proactive.mjs
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pickProactive } from '../organs/hippocampus/lib/proactive.js'

const fails = []
const ok = (c, m) => { if (!c) fails.push(m) }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const now = Date.now()

// ── 纯逻辑 ────────────────────────────────────────────────
const hits = [
  { episodeId: 'a', score: 0.82, start: now - 2 * 3600e3, summary: '她下周三要去面结构设计岗，带图纸和成绩单' },
  { episodeId: 'b', score: 0.30, start: now - 2 * 3600e3, summary: '今天跑了一遍测试，都过了' },
]
const p1 = pickProactive(hits, { now })
ok(p1 && p1.id === 'a', `该冒的没冒：${JSON.stringify(p1)}`)
const p2 = pickProactive([{ episodeId: 'b', score: 0.30, start: now, summary: '今天跑了一遍测试都过了' }], { now })
ok(p2 === null, '分数不够也冒了（会变成每句都扯旧账）')
const p3 = pickProactive(hits, { now, surfaced: new Map([['a', now - 60e3]]) })
ok(p3 === null, '冷却期内又冒了同一条')
const p4 = pickProactive(hits, { now, surfaced: new Map([['a', now - 31 * 60e3]]) })
ok(p4 && p4.id === 'a', '冷却过了还不冒')
const p5 = pickProactive([{ episodeId: 'c', score: 0.9, start: now - 400 * 24 * 3600e3, summary: '很久以前的一件事，已经没必要提了' }], { now })
ok(p5 === null, '太旧的还主动提')
const p6 = pickProactive([{ episodeId: 'd', score: 0.9, start: now, summary: '短' }], { now })
ok(p6 === null, '只有两个字也主动提')

// ── 接线：真写进去、真进 prompt ────────────────────────────
const root = mkdtempSync(join(tmpdir(), 'pro-'))
process.env.DSH_HOME = root
process.env.HIPPOCAMPUS_DIR = join(root, 'hippocampus')
process.env.CORTEX_DIR = join(root, 'cortex')
process.env.AMYGDALA_DIR = join(root, 'amygdala')

const services = new Map()
const handlers = new Map()
const listen = (n, f) => { if (!handlers.has(n)) handlers.set(n, []); handlers.get(n).push(f); return () => {} }
const emit = (n, ...args) => { for (const f of handlers.get(n) || []) { try { void f(...args) } catch { /* 忽略 */ } } return true }
const agents = []
const ctx = {
  systemPrompt: { context: () => () => {} },
  webServer: { register: () => () => {} },
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

await hip.write({ role: 'user', text: '我下周三要去面结构设计岗，记得带上 SolidWorks 图纸和成绩单。', session: 'p1', force: true })
for (let i = 0; i < 6; i += 1) {
  await hip.write({ role: 'user', text: `随便聊第${i}句：今天有点困。`, session: 'p1', force: true })
}
await hip.settle({ force: true })

const injected = new Map()
const agentHandlers = new Map()
const onAgent = (n, f) => { if (!agentHandlers.has(n)) agentHandlers.set(n, []); agentHandlers.get(n).push(f); return () => {} }
const fire = (n, p) => { for (const f of agentHandlers.get(n) || []) { void f(p) } }
const agent = {
  id: 'pa-1',
  ctx: { systemPrompt: { context: (x) => { injected.set(x.name, x); return () => {} } }, on: onAgent, effect: () => () => {}, tools: { register: () => () => {} } },
}
agents.push(agent)
emit('agent/created', { agent })
await sleep(300)

ok(injected.has('memory-proactive'), '没有注册 memory-proactive 注入')

// 相关的一句话 → 应该想起面试那件事
emit('session/event', { id: 'pa-1' }, { type: 'user/message', data: { text: '面试准备得怎么样了，图纸带了吗' } })
await sleep(4000)
const readText = (name) => {
  const entry = injected.get(name)
  if (!entry) return ''
  const fn = typeof entry === 'function' ? entry : entry.text
  return typeof fn === 'function' ? String(fn() || '') : ''
}
console.log('DIAG', JSON.stringify(hip.proactiveDebug?.() ?? null))
const line = readText('memory-proactive')
ok(line.length > 0, '碰到了相关的话，却没主动想起任何事')
ok(/结构设计|图纸/.test(line), `想起的不是那件事：${line}`)

// 同一条 30 分钟内不许再冒
emit('session/event', { id: 'pa-1' }, { type: 'user/message', data: { text: '图纸再确认一下' } })
await sleep(2500)
ok(readText('memory-proactive') === '' || !/结构设计/.test(readText('memory-proactive')), '同一条在冷却期内又冒了')

rmSync(root, { recursive: true, force: true })

if (fails.length) {
  console.log(`FAIL ${fails.length}:`)
  for (const f of fails) console.log(' - ' + f)
  process.exit(1)
}
console.log('PASS 主动想起（够强才冒 / 弱的不冒 / 冷却生效 / 太旧不冒 / 真进了 prompt）')
process.exit(0)
