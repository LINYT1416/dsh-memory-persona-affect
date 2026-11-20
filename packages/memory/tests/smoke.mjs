// 冒烟：从 profile 的真实解析路径加载 dsh-all，验证
//   1. 四个器官都能 apply
//   2. 工具全注册
//   3. 注入开关按 config.json 生效（systemPrompt.context 的注册名单）

import { apply } from 'dsh-all'

const tools = []
const services = new Map()
const contextBlocks = []

const fakeAgent = {
  id: 'smoke-agent',
  ctx: {
    systemPrompt: {
      context(block) {
        contextBlocks.push(block?.name || '?')
        return () => {}
      },
    },
    effect(fn) { if (typeof fn === 'function') fn() },
    on() { return () => {} },
    emit() { return true },
    get(n) { return ctx.get(n) },
  },
}

const ctx = {
  tools: { register(t) { tools.push(t?.name || '?'); return () => {} } },
  webServer: { register() { return () => {} } },
  agents: { list: () => [fakeAgent] },
  provide(n, v) { services.set(n, v) },
  set(n, v) { services.set(n, v) },
  get(n) {
    if (n === 'tools') return ctx.tools
    if (n === 'webServer') return ctx.webServer
    if (n === 'agents') return ctx.agents
    return services.get(n) || null
  },
  effect(fn) { if (typeof fn === 'function') fn() },
  on() { return () => {} },
  emit() { return true },
}

let dispose = null
let error = null
try {
  dispose = apply(ctx)
} catch (e) {
  error = String(e?.stack || e)
}

const brain = services.get('memory.brain')
console.log(JSON.stringify({
  ok: !error,
  error,
  tools: tools.length,
  services: [...services.keys()],
  injectConfig: brain?.status?.()?.inject || null,
  systemPromptBlocks: contextBlocks,
  expectedBlocks: ['hippocampus-index'],
}, null, 2))

try { if (typeof dispose === 'function') dispose() } catch { /* ignore */ }
process.exit(0)
