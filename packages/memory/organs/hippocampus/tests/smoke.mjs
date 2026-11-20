// 冒烟：用 mock ctx 把插件加载一遍，确认 apply() 不抛错、能挂上工具和事件。
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const dir = mkdtempSync(join(tmpdir(), 'hippo-smoke-'))
process.env.HIPPOCAMPUS_DIR = dir

const { apply } = await import('../index.js')

const registered = []
const events = []
const provided = {}
let disposed = 0

const ctx = {
  on(name, handler) {
    events.push({ name, handler })
    return () => {}
  },
  effect(fn) {
    const d = fn()
    return () => { disposed += 1; d?.() }
  },
  get() { return null },
  provide(name, value) { provided[name] = value },
  set(name, value) { provided[name] = value },
  emit(name) { return undefined },
  tools: {
    get(name) { return registered.find((t) => t.name === name) },
    register(tool) { registered.push(tool); return () => {} },
  },
  agents: { list: () => [] },
}

const dispose = apply(ctx)
assert.equal(typeof dispose, 'function')

await new Promise((r) => setTimeout(r, 800))

const names = registered.map((t) => t.name)
assert.ok(names.includes('hippocampus_recall'), 'recall tool registered')
assert.ok(names.includes('hippocampus_stats'), 'stats tool registered')
assert.ok(events.some((e) => e.name === 'agent/created'), 'agent/created hooked')
assert.ok(events.some((e) => e.name === 'session/event'), 'session/event hooked')

// 工具调用冒烟
const stats = registered.find((t) => t.name === 'hippocampus_stats')
const out = await stats.execute({}, {})
assert.ok(out.content[0].text.includes('episodes'))

const write = registered.find((t) => t.name === 'hippocampus_write')
await write.execute({ text: '我的猫叫布丁，今年三岁' }, { agent: { id: 'session-smoke' } })
const recall = registered.find((t) => t.name === 'hippocampus_recall')
const found = await recall.execute({ query: '布丁' }, { agent: { id: 'session-smoke' } })
assert.ok(found.content[0].text.includes('布丁'), 'recall should find it')

// 器官接缝：前额叶要的五个同步口 + 皮层要的只读投影，一个都不能少
const api = provided['memory.hippocampus']
assert.ok(api, 'memory.hippocampus should be provided')
for (const key of ['recall', 'episode', 'source', 'conflicts', 'traces', 'episodes', 'raw', 'quiet']) {
  assert.equal(typeof api[key], 'function', `missing seam: ${key}`)
}
assert.equal(typeof api.vectorReady, 'boolean', 'vectorReady should be a boolean')
const eps = await api.episodes({ limit: 5 })
assert.ok(Array.isArray(eps), 'episodes() should return array')
const st = await api.stats()
assert.ok(st && typeof st.capabilities === 'object', 'stats should carry capabilities')

dispose()
console.log('smoke ok:', names.join(', '))
// 插件里有定时器和后台预热，测试进程不主动退会一直挂着
process.exit(0)
