// 三器官链接测试：用假服务验证整条调用链真的通了。
// 跑：node tests/integration.mjs
import assert from 'node:assert/strict'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const dir = await mkdtemp(join(tmpdir(), 'hippo-integ-'))
process.env.HIPPOCAMPUS_DIR = dir

const { HippoStore } = await import('../lib/memory.js')
const { makeEncoder } = await import('../lib/encode.js')
const { makeRecall } = await import('../lib/recall.js')
const { makeConsolidator } = await import('../lib/consolidate.js')
const { makeLayerSwitch } = await import('../lib/decay.js')
const { makeOrgans } = await import('../lib/adapters.js')

const calls = { gate: 0, plan: 0, judge: 0, extract: 0, upsert: 0, handoff: 0, salience: 0, concepts: 0 }
const cells = []
let lastSnapshot = null
let lastUpsert = null

const services = {
  'memory.cortex': {
    extract: (snap) => {
      calls.extract += 1
      lastSnapshot = snap
      cells.push({ id: 'cell-uid', episodes: [snap.id], text: '我的B站uid是1000003' })
      return [{ kind: 'fact', subject: '主人', predicate: '账号', object: '1000003', text: '我的B站uid是1000003' }]
    },
    upsert: (cands) => {
      calls.upsert += 1
      lastUpsert = cands
      return { accepted: cands.length }
    },
    handoff: () => { calls.handoff += 1; return true },
    // 新一版皮层多了这三个：概念召回 + cell→episode 反查 + 语义边
    concepts: (q) => { calls.concepts += 1; return { query: q, items: cells.map((c) => ({ id: c.id, score: 0.9, text: c.text })) } },
    anchorsOf: (id) => ({ id, episodes: cells.find((c) => c.id === id)?.episodes || [] }),
    relations: () => [],
  },
  'memory.amygdala': {
    salience: (text) => { calls.salience += 1; return { score: 0.92, why: 'mock' } },
  },
  'memory.prefrontal': {
    gate: (text) => { calls.gate += 1; return { keep: true, depth: 2, reason: 'mock' } },
    plan: (q) => { calls.plan += 1; return { mode: 'separate', filters: {}, why: ['mock'] } },
    judge: (hits) => { calls.judge += 1; return { verdicts: [], kept: hits?.length || 0 } },
  },
}

const organs = makeOrgans({ get: (name) => services[name] || null })

const results = []
async function check(name, fn) {
  try {
    await fn()
    results.push({ name, ok: true })
  } catch (error) {
    results.push({ name, ok: false, error: String(error?.message || error) })
  }
}

// 0 探测
await check('三个器官都能探测到', async () => {
  assert.equal(organs.capabilities.cortex, true)
  assert.equal(organs.capabilities.amygdala, true)
  assert.equal(organs.capabilities.prefrontal, true)
})

// 1 适配形状
await check('杏仁核分数被翻译成 {score, source}', async () => {
  const r = organs.amygdala.salience('测试')
  assert.equal(r.score, 0.92)
  assert.equal(r.source, 'amygdala')
})

await check('前额叶 gate 的 {keep} 被翻成布尔', async () => {
  assert.equal(organs.prefrontal.shouldRemember('测试'), true)
  assert.equal(typeof organs.prefrontal.gateDetail('测试'), 'object')
})

// 2 写路径：gate + salience
const store = new HippoStore()
await store.init()
const encoder = makeEncoder({ store, adapters: organs })
const recaller = makeRecall({ store, adapters: organs })
const consolidator = makeConsolidator({ store, adapters: organs, layers: makeLayerSwitch() })

const S = 'session-integ'
const t0 = Date.now() - 30 * 60 * 1000
let epId = null

await check('写入时调用了前额叶 gate 和杏仁核 salience', async () => {
  const out = await encoder.ingest({ session: S, role: 'user', text: '我的B站uid是1000003，昵称叫示例主人', at: t0, channel: 't', msgId: 'i1' })
  assert.ok(out.episodeId)
  epId = out.episodeId
  assert.ok(calls.gate >= 1, 'gate should be called')
  assert.ok(calls.salience >= 1, 'salience should be called')
})

await check('杏仁核的分进了 episode（0.92）', async () => {
  const ep = store.get(epId)
  assert.equal(ep.salience, 0.92)
  assert.equal(ep.salienceSource, 'amygdala')
})

// 3 巩固：extract → upsert → handoff
await check('巩固时皮层被调用：extract 收到快照（带 rawTexts）', async () => {
  store.closeIfStale(S, Date.now() + 40 * 60 * 1000)
  await consolidator.run({ mode: 'deep', now: Date.now() })
  assert.ok(calls.extract >= 1, 'extract should be called')
  assert.ok(lastSnapshot && Array.isArray(lastSnapshot.rawTexts), 'snapshot must carry rawTexts')
  assert.equal(lastSnapshot.id, epId)
})

await check('upsert 收到的是扁平候选（subject/object 齐全）', async () => {
  assert.ok(calls.upsert >= 1, 'upsert should be called')
  assert.ok(Array.isArray(lastUpsert))
  assert.ok(lastUpsert.every((c) => c.subject && c.object), JSON.stringify(lastUpsert))
})

await check('handoff 返回 true 时 episode 退场到 retired', async () => {
  assert.ok(calls.handoff >= 1, 'handoff should be called')
  assert.equal(store.get(epId).transferState, 'retired')
})

// 4 检索：plan → separate → judge
await check('检索时前额叶 plan 生效（返回 separate 就走分离）', async () => {
  const out = await recaller.recall('1000003', { k: 3 })
  assert.ok(calls.plan >= 1, 'plan should be called')
  assert.equal(out.mode, 'separate')
  assert.ok(out.plan && out.plan.why)
})

await check('结果出来会主动送前额叶校验', async () => {
  // verify 是 fire-and-forget，等一拍
  await new Promise((r) => setTimeout(r, 100))
  assert.ok(calls.judge >= 1, 'judge should be called')
})

await check('给皮层的快照不重复喂同一句（否则会被抽成多条 cell）', async () => {
  assert.equal(lastSnapshot.text, '', 'text 不该和 summary 重复')
  const pieces = [lastSnapshot.summary, ...(lastSnapshot.rawTexts || [])].filter(Boolean)
  assert.equal(new Set(pieces).size, pieces.length, JSON.stringify(pieces))
})

// 4.5 E5 概念路：皮层 concept → anchorsOf → episode
await check('概念路能落回 episode（E5）', async () => {
  const out = await recaller.recall('主人的B站账号', { mode: 'complete', k: 3 })
  assert.ok(calls.concepts >= 1, 'concepts should be called')
  assert.ok(out.hits.some((h) => String(h.why).includes('concept')), JSON.stringify(out.hits.map((h) => h.why)))
})

// 5 对照：器官撤掉后仍然能跑（单器官降级）
await check('器官全撤掉，插件仍能读写', async () => {
  const bare = makeOrgans({ get: () => null })
  assert.equal(bare.capabilities.cortex, false)
  const s2 = new HippoStore()
  await s2.init()
  const enc2 = makeEncoder({ store: s2, adapters: bare })
  const out = await enc2.ingest({ session: 's-bare', role: 'user', text: '布丁是一只三岁的橘猫', at: Date.now(), channel: 't', msgId: 'b1' })
  assert.ok(out.episodeId, 'should still encode')
})

let pass = 0
for (const r of results) {
  if (r.ok) { pass += 1; console.log(`  ok  ${r.name}`) }
  else console.log(`  FAIL ${r.name}\n       ${r.error}`)
}
console.log(`\n${pass}/${results.length} passed`)
console.log('calls:', JSON.stringify(calls))
process.exit(pass === results.length ? 0 : 1)
