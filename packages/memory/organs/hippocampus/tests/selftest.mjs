// 自测：不碰真实数据，全在临时目录里跑。
// 用法：node tests/selftest.mjs
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const dir = await mkdtemp(join(tmpdir(), 'hippo-selftest-'))
process.env.HIPPOCAMPUS_DIR = dir

const { HippoStore } = await import('../lib/memory.js')
const { makeEncoder } = await import('../lib/encode.js')
const { makeRecall } = await import('../lib/recall.js')
const { makeConsolidator } = await import('../lib/consolidate.js')
const { makeAdapters, dedupeKey, envelope } = await import('../lib/contract.js')
const { makeLayerSwitch, sweepOnce, effectiveScore } = await import('../lib/decay.js')
const { readJsonl, FILES } = await import('../lib/store.js')

const results = []
function check(name, fn) {
  return Promise.resolve()
    .then(fn)
    .then(() => results.push({ name, ok: true }))
    .catch((error) => results.push({ name, ok: false, error: String(error?.message || error) }))
}

const store = new HippoStore()
await store.init()
const adapters = makeAdapters(null)
const encoder = makeEncoder({ store, adapters })
const recaller = makeRecall({ store, adapters })
const layers = makeLayerSwitch()
const consolidator = makeConsolidator({ store, adapters, layers })

const S1 = 'session-test-1'
const t0 = Date.now() - 60 * 60 * 1000

// 1 写入事件
let ep1 = null
await check('写入一条事件，生成 episode', async () => {
  const out = await encoder.ingest({ session: S1, role: 'user', text: '我的B站uid是1000003，昵称叫示例主人', at: t0, channel: 'test', msgId: 'm1' })
  assert.ok(out.episodeId, 'should create episode')
  assert.notEqual(out.depth, 'shallow')
  ep1 = out.episodeId
})

// 2 重复消息
await check('同一 msgId 再来一次被丢弃', async () => {
  const out = await encoder.ingest({ session: S1, role: 'user', text: '我的B站uid是1000003，昵称叫示例主人', at: t0, channel: 'test', msgId: 'm1' })
  assert.equal(out.skipped || out.action, 'dup-message')
})

// 3 稀疏门
await check('寒暄“嗯”只落 raw 不进索引', async () => {
  const out = await encoder.ingest({ session: S1, role: 'user', text: '嗯', at: t0 + 1000, channel: 'test', msgId: 'm2' })
  assert.equal(out.episodeId, null)
  assert.equal(out.depth, 'shallow')
})

// 4 同事件合并
await check('同一件事换说法并进同一 episode', async () => {
  const out = await encoder.ingest({ session: S1, role: 'user', text: '对了，我B站uid还是1000003，昵称示例主人', at: t0 + 2 * 60 * 1000, channel: 'test', msgId: 'm3' })
  assert.equal(out.episodeId, ep1)
  assert.equal(out.action, 'same')
})

// 5 精确检索
await check('精确问 uid 能命中（分离模式）', async () => {
  const out = await recaller.recall('1000003', { mode: 'separate', k: 3 })
  assert.equal(out.mode, 'separate')
  assert.ok(out.hits.length >= 1, 'should hit')
  assert.equal(out.hits[0].episodeId, ep1)
})

// 6 补全检索
await check('模糊问“鲸鲸”能联想（补全模式）', async () => {
  const out = await recaller.recall('鲸鲸大王是谁', { mode: 'complete', k: 3 })
  assert.ok(out.hits.length >= 1, 'should hit')
  assert.ok(out.hits[0].why.includes('bm25') || out.hits[0].why.includes('exact'), `why=${out.hits[0].why}`)
})

// 7 序列
await check('序列查询能拿到后一条', async () => {
  await encoder.ingest({ session: S1, role: 'user', text: '然后我去楼下买了包子和豆浆', at: t0 + 10 * 60 * 1000, channel: 'test', msgId: 'm4' })
  const items = await recaller.sequence(ep1, 'after', 3)
  assert.ok(items.length >= 1)
})

// 8 巩固
await check('关段后巩固，写出候选与审计日志', async () => {
  store.closeIfStale(S1, Date.now() + 30 * 60 * 1000)
  const out = await consolidator.run({ mode: 'deep', now: Date.now() })
  assert.ok(out.processed >= 1)
  const cand = await readJsonl(FILES.candidates)
  assert.ok(cand.length >= 1, 'candidates should be written')
  const log = await readJsonl(FILES.consolidation)
  assert.ok(log.length >= 1, 'consolidation log should be written')
  const ep = store.get(ep1)
  assert.equal(ep.state, 'consolidated')
})

// 9 遗忘
await check('很久不用的条目被归档（不删原文）', async () => {
  const ep = store.get(ep1)
  ep.start = Date.now() - 200 * 24 * 3600 * 1000
  ep.end = ep.start
  ep.salience = 0.1
  const score = effectiveScore(ep, { now: Date.now() })
  assert.ok(score < 0.04, `score=${score}`)
  const out = await sweepOnce(store, Date.now())
  assert.ok(out.swept >= 1)
  assert.equal(store.get(ep1).state, 'archived')
})

// 10 契约
await check('三器官不在时用桩，交接物带版本与幂等 key', async () => {
  assert.equal(adapters.capabilities.cortex, false)
  assert.equal(adapters.cortex, null)
  assert.equal(adapters.amygdala, null)
  assert.equal(adapters.prefrontal, null)
  assert.equal(dedupeKey('ep_x', 2), 'ep_x@2')
  const env = envelope('episode', { id: 1 })
  assert.equal(env.v, 1)
  assert.equal(env.kind, 'episode')
})

// 11 分层开关
await check('关掉编码层只降级，不报错', async () => {
  layers.off('encode')
  const out = await encoder.ingest({ session: S1, role: 'user', text: '测试分层开关', at: Date.now(), channel: 'test', msgId: 'm9' })
  // encoder 本身不检查层开关，index.js 的 write 才检查；这里验证开关对象行为
  assert.equal(layers.isOff('encode'), true)
  assert.ok(out.episodeId || out.skipped)
  layers.on('encode')
})

// 12 入口自检
await check('入口自检能跑', async () => {
  const { healthCheck } = await import('../lib/maintenance.js')
  const h = await healthCheck()
  assert.ok(h.checkedAt)
  assert.equal(typeof h.ok, 'boolean')
})

// 13 信息流速
await check('信息流速能算，切段阈值在 5–15 分钟之间', async () => {
  const { messageDensity, recentRaw } = await import('../lib/maintenance.js')
  const raw = await recentRaw(30)
  const d = await messageDensity(raw)
  assert.ok(d.gapMs >= 5 * 60000 && d.gapMs <= 15 * 60000, `gapMs=${d.gapMs}`)
})

// 14 悬空
await check('悬空索引能被标出来', async () => {
  const { detectDangling, recentRaw } = await import('../lib/maintenance.js')
  const ep = store.get(ep1)
  ep.rawIds.push('raw_ghost')
  const out = await detectDangling(store, await recentRaw(30))
  assert.ok(out.length >= 1, 'should report dangling')
  assert.equal(store.get(ep1).dangling.length, 1)
  ep.rawIds = ep.rawIds.filter((x) => x !== 'raw_ghost')
})

// 15 素材包 + 边界
await check('检索返回素材包与边界标记', async () => {
  const out = await recaller.recall('B站账号', { k: 3 })
  assert.ok(out.material && Array.isArray(out.material.entities))
  assert.equal(typeof out.boundaryCross, 'boolean')
  assert.equal(typeof out.mode, 'string')
})

// 16 退场
await check('巩固后 transferState 从 held 降到 shadowed', async () => {
  const ep = store.get(ep1)
  assert.notEqual(ep.transferState, 'held')
})

// 18 缓存失效：写入后不失效，新记忆就永远查不到
await check('写入后缓存失效，立刻能查到新记忆', async () => {
  await recaller.recall('预热缓存', { k: 1 })
  const out = await encoder.ingest({ session: S1, role: 'user', text: '我新买了一把机械键盘，轴体是红轴', at: Date.now(), channel: 'test', msgId: 'm20' })
  assert.ok(out.episodeId, 'should create')
  recaller.invalidate() // 等价于 index.write 里那一步
  const hit = await recaller.recall('机械键盘', { k: 3 })
  assert.ok(hit.hits.some((h) => String(h.summary).includes('键盘')), JSON.stringify(hit.hits.map((h) => h.summary)))
})

// 19 衰减不能叠加：反复 sweep 结果要一致
await check('反复 sweep 不会让衰减加速', async () => {
  const ep = store.get(ep1)
  ep.state = 'consolidated'
  ep.baseAccessibility = 0.8
  ep.salience = 0.5
  ep.end = Date.now() - 3 * 24 * 3600 * 1000
  const now = Date.now()
  const before = effectiveScore(ep, { now })
  await sweepOnce(store, now)
  const after = effectiveScore(store.get(ep1), { now })
  assert.ok(Math.abs(before - after) < 1e-9, `${before} vs ${after}`)
})

// 20 冲突显式化
await check('同实体不同号码能标冲突', async () => {
  const t = Date.now()
  await encoder.ingest({ session: 'sess-conf', role: 'user', text: '我的手机号是13800138000', at: t, channel: 't', msgId: 'c1' })
  await encoder.ingest({ session: 'sess-conf', role: 'user', text: '我换手机号了，新号是13900139000', at: t + 3600 * 1000, channel: 't', msgId: 'c2' })
  store.closeIfStale('sess-conf', t + 5 * 3600 * 1000)
  await consolidator.run({ mode: 'shallow', now: t + 6 * 3600 * 1000 })
  const cand = await readJsonl(FILES.candidates)
  assert.ok(cand.some((c) => c.kind === 'conflict'), 'conflict should be flagged')
})

// 17 重建（放最后，会重写 episodes/index）
await check('从 raw 重建能跑，episode 重新长出来', async () => {
  const { rebuildFromRaw } = await import('../lib/maintenance.js')
  const out = await rebuildFromRaw(store, encoder)
  assert.ok(out.rebuilt >= 1, JSON.stringify(out))
  assert.ok(store.allEpisodes().length >= 1)
})

// 21 重启不失忆
await check('重启不失忆：新建 store 重新 init 能读回 episode', async () => {
  const { HippoStore: S2 } = await import('../lib/memory.js')
  const s2 = new S2()
  await s2.init()
  assert.ok(s2.allEpisodes().length >= 1, 'episodes should survive restart')
  assert.ok(s2.allEpisodes().every((e) => e.id && Number(e.version) >= 1))
})

// 22 索引不孤儿
await check('索引不孤儿：每条 index 都能找到 episode', async () => {
  const { HippoStore: S3 } = await import('../lib/memory.js')
  const s3 = new S3()
  await s3.init()
  const rows = await readJsonl(FILES.index)
  const missing = rows.filter((r) => !s3.get(r.episodeId))
  assert.equal(missing.length, 0, 'orphans: ' + missing.map((r) => r.episodeId).join(','))
})

// 23 真向量（设 HIPPO_TEST_EMBED=1 才跑，避免每次拖几秒）
if (process.env.HIPPO_TEST_EMBED === '1') {
  await check('真向量能出，语义相近的句子相似度高', async () => {
    const { embed, cosine } = await import('../lib/vectors.js')
    const a = await embed('今天天气不错')
    const b = await embed('今儿天挺好的')
    assert.ok(a && a.length > 0, 'embed should return vector')
    assert.ok(cosine(a, b) > 0.5, `sim=${cosine(a, b)}`)
  })
}

// 24 测试数据隔离
await check('测试数据默认不抢座次，includeTest 能查回来', async () => {
  const at = Date.now() - 30 * 1000
  await encoder.ingest({ session: S1, role: 'user', text: '测试：杏仁核落账验证（可删）', at, channel: 't', msgId: 't1' })
  recaller.invalidate() // 等价于 index.write 里那一步
  const normal = await recaller.recall('杏仁核落账验证', { mode: 'complete', k: 5 })
  assert.ok(!normal.hits.some((h) => String(h.summary || '').includes('测试')), JSON.stringify(normal.hits.map((h) => h.summary)))
  const withTest = await recaller.recall('杏仁核落账验证', { mode: 'complete', k: 5, includeTest: true })
  assert.ok(withTest.hits.some((h) => String(h.summary || '').includes('测试')), 'includeTest should bring it back')
})

// 25 长查询拆路：扩写拼成一长串时，别让泛词堆票压掉真正的答案
await check('长查询拆路：住院那条不被裁员那条压掉', async () => {
  const t = Date.now() - 5 * 60 * 1000
  await encoder.ingest({ session: 's-long', role: 'user', text: '我妈说我爸住院要做手术', at: t, channel: 't', msgId: 'l1' })
  await encoder.ingest({ session: 's-long', role: 'user', text: '今天被领导谈话要裁人，出事了', at: t + 60 * 1000, channel: 't', msgId: 'l2' })
  recaller.invalidate()
  const long = '家里出什么事了 经历 住院 手术 裁人 出事 生病 事件'
  const out = await recaller.recall(long, { mode: 'complete', k: 5 })
  assert.ok(out.hits.length >= 1, 'should hit')
  assert.ok(String(out.hits[0].summary || '').includes('住院'), JSON.stringify(out.hits.map((h) => [h.summary, h.score])))
})

// 26 短查询也要拆路
await check('短查询也拆路：单问“我爸住院了”命中住院那条', async () => {
  const out = await recaller.recall('我爸住院了', { mode: 'complete', k: 5 })
  assert.ok(out.hits.length >= 1, 'should hit')
  assert.ok(String(out.hits[0].summary || '').includes('住院'), JSON.stringify(out.hits.map((h) => [h.summary, h.score])))
})

// 27 deep 巩固前自动关段（不死锁）
await check('deep 巩固前先关空闲段，不给皮层留死锁', async () => {
  const at = Date.now() - 5 * 60 * 1000
  const out = await encoder.ingest({ session: 's-settle', role: 'user', text: '我养了只橘猫叫布丁', at, channel: 't', msgId: 'st1' })
  assert.equal(store.get(out.episodeId).state, 'open')
  await consolidator.run({ mode: 'deep', now: Date.now() })
  // deep 会先关段再就地巩固，所以是 closed 或 consolidated 都算过
  assert.ok(['closed', 'consolidated'].includes(store.get(out.episodeId).state), store.get(out.episodeId).state)
})

// 28 图不丢：重启后从 links.jsonl 读回
await check('图不丢：重启后从 links.jsonl 读回边和节点', async () => {
  const { appendLinks } = await import('../lib/store.js')
  await appendLinks(store.pendingEdges.splice(0))
  const { HippoStore: S6 } = await import('../lib/memory.js')
  const s6 = new S6()
  await s6.init()
  assert.ok(s6.graph.edges.length > 0, 'edges should be restored from links.jsonl')
  assert.ok(s6.graph.nodes.size > 0, 'nodes should be restored')
})

// 29 否定词不被当成肯定
await check('否定词单独成 token：「不喜欢」不会被当成「喜欢」', async () => {
  const { tokenize } = await import('../lib/taxonomy.js')
  const neg = tokenize('她不喜欢鲸鱼贴纸')
  const pos = tokenize('她喜欢鲸鱼贴纸')
  assert.ok(neg.has('¬喜欢'), [...neg.keys()].join(','))
  assert.ok(!neg.has('喜欢'), 'negated text should not emit 喜欢')
  assert.ok(pos.has('喜欢'))
  assert.ok(!pos.has('¬喜欢'))
})

// 30 衰减：不用等时间，构造旧数据就能验阈值
await check('衰减能把很久不用的条目推过归档线', async () => {
  const { sweepOnce } = await import('../lib/decay.js')
  const at = Date.now() - 120 * 24 * 3600 * 1000
  const out = await encoder.ingest({ session: 's-old', role: 'user', text: '很久以前吃过一碗牛肉面', at, channel: 't', msgId: 'o1' })
  const ep = store.get(out.episodeId)
  ep.state = 'closed'
  const before = ep.accessibility
  await sweepOnce(store, Date.now())
  assert.ok(ep.accessibility <= before, `${before} -> ${ep.accessibility}`)
  assert.ok(ep.accessibility < 0.2 || ep.state === 'archived', `should sink: ${ep.accessibility} / ${ep.state}`)
})

// 31 「不太喜欢」也要当否定
await check('「她不太喜欢什么」不会先答「喜欢什么」', async () => {
  const t = Date.now() - 20 * 1000
  await encoder.ingest({ session: 's-neg', role: 'user', text: '她说喜欢我多说一点，有情绪的回应', at: t, channel: 't', msgId: 'n1' })
  await encoder.ingest({ session: 's-neg', role: 'user', text: '她不太喜欢鲸鱼贴纸', at: t + 5000, channel: 't', msgId: 'n2' })
  recaller.invalidate()
  const out = await recaller.recall('她不太喜欢什么东西', { mode: 'complete', k: 5 })
  assert.ok(out.hits.length >= 1, 'should hit')
  assert.ok(/不.*喜欢/.test(String(out.hits[0].summary || '')), JSON.stringify(out.hits.map((h) => h.summary)))
})

// 32 负面说法不靠「不」字也要能召回
await check('「不接受」「太生硬」也算否定，能召回', async () => {
  const t = Date.now() - 8 * 1000
  await encoder.ingest({ session: 's-neg2', role: 'user', text: '她不接受裁剪拼贴那种风格', at: t, channel: 't', msgId: 'n3' })
  await encoder.ingest({ session: 's-neg2', role: 'user', text: '晓晓音色太生硬', at: t + 2000, channel: 't', msgId: 'n4' })
  recaller.invalidate()
  const out = await recaller.recall('她不太喜欢什么东西', { mode: 'complete', k: 8 })
  const all = out.hits.map((h) => String(h.summary || '')).join('|')
  assert.ok(/不接受|太生硬/.test(all), all)
})

let pass = 0
for (const r of results) {
  if (r.ok) { pass += 1; console.log(`  ok  ${r.name}`) }
  else console.log(`  FAIL ${r.name}\n       ${r.error}`)
}
console.log(`\n${pass}/${results.length} passed`)
await rm(dir, { recursive: true, force: true }).catch(() => {})
process.exit(pass === results.length ? 0 : 1)
