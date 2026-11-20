// 冒烟：用假 ctx 把插件挂起来，确认工具注册、服务 provide、蒸馏与检索都能走通。
// 用法：node tests/smoke.mjs
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const dir = await mkdtemp(join(tmpdir(), 'cortex-smoke-'))
process.env.CORTEX_DIR = dir
process.env.HIPPOCAMPUS_DIR = join(dir, 'hippo-empty')
await mkdir(process.env.HIPPOCAMPUS_DIR, { recursive: true })

const fake = await import('./fake-organs.mjs')
const mod = await import('../index.js')
assert.ok(Array.isArray(mod.inject), 'index.js must export inject')
assert.ok(mod.inject.includes('tools'), 'inject must include tools')
assert.ok(mod.inject.includes('webServer'), 'inject must include webServer')
const { apply } = mod

const eps = fake.makeEpisodes()
const registered = []
const provided = {}
const ctx = {
  get: (name) => (name === 'memory.hippocampus' ? fake.makeHippocampus('normal', eps) : null),
  provide: (name, api) => { provided[name] = api },
  set: () => {},
  tools: { register: (tool) => registered.push(tool), get: () => null },
  agents: { list: () => [] },
  on: () => () => {},
  effect: () => {},
}

apply(ctx)

for (let i = 0; i < 60 && !provided['memory.cortex']; i++) await fake.sleep(50)
assert.ok(provided['memory.cortex'], 'memory.cortex should be provided')
assert.equal(registered.length, 11, `tools=${registered.map((t) => t.name).join(',')}`)

const api = provided['memory.cortex']
const out = await api.distill({ episodes: eps })
assert.equal(out.processed, 12, JSON.stringify(out))

const ans = await api.ask('1000003')
assert.ok(ans.hits.length >= 1, JSON.stringify(ans))

const health = await api.health()
assert.equal(health.ok, true)
assert.equal(health.level, 'L1')

const tools = registered.map((t) => t.name)
assert.ok(tools.includes('cortex_ask'))
assert.ok(tools.includes('cortex_correct'))

// 多器官契约：前额叶用 callSync 调这四个，必须同步返回，不能是 Promise
const ARG = { concepts: '喜欢', search: '喜欢', contradicts: ['a', 'b'], summarize: [] }
for (const name of ['concepts', 'search', 'contradicts', 'summarize']) {
  assert.equal(typeof api[name], 'function', `${name} should exist`)
  const out = api[name](ARG[name])
  assert.equal(typeof out?.then, 'undefined', `${name} must be sync, not Promise`)
}
assert.ok(api.features.includes('contradicts'))
assert.ok(api.features.includes('expand'))
assert.ok(api.expand('家里出什么事了').includes('住院'))
assert.ok(Array.isArray(api.search('喜欢').hits))

// E5/E8：cell → episode 映射必须能拿到，否则海马体的 c: 和 e: 会搅在一起
const hits = api.search('喜欢').hits
assert.ok(hits.length >= 1, 'search should hit')
assert.ok(Array.isArray(hits[0].supportIds), 'hit should carry supportIds')
const anchors = api.anchorsOf(hits[0].cellId)
assert.ok(Array.isArray(anchors.episodes), 'anchorsOf should return episodes')
assert.ok(anchors.episodes.length >= 1, `episodes=${JSON.stringify(anchors)}`)
const cpt = api.concepts('喜欢')
assert.ok(Array.isArray(cpt.items))
assert.ok(Array.isArray(cpt.items[0]?.supportIds), 'concept item should carry supportIds')

// 海马体入站 upsert：两种形状都要接，第二次推同一件事要累计证据而不是跳过
const r1 = api.upsert([{ episodeId: 'ep_u1', facts: [{ kind: 'fact', subject: '测试主体', predicate: '账号', object: 'u-1' }] }])
assert.equal(r1.accepted, 1)
const r2 = api.upsert([{ episodeId: 'ep_u2', facts: [{ kind: 'fact', subject: '测试主体', predicate: '账号', object: 'u-1' }] }])
assert.equal(r2.accepted, 1)
const upHit = api.search('测试主体').hits.find((h) => h.text.includes('u-1'))
assert.ok(upHit, 'upserted cell should be searchable')
assert.equal(upHit.state, 'fact')
assert.equal(upHit.supportIds.length, 2, `supportIds=${JSON.stringify(upHit.supportIds)}`)

console.log('smoke ok:', tools.join(', '))
await rm(dir, { recursive: true, force: true }).catch(() => {})
