// 自测：不碰真实数据，全在临时目录里跑。
// 用法：node tests/selftest.mjs
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const dir = await mkdtemp(join(tmpdir(), 'cortex-selftest-'))
process.env.CORTEX_DIR = dir
process.env.HIPPOCAMPUS_DIR = join(dir, 'hippo-empty')
await mkdir(process.env.HIPPOCAMPUS_DIR, { recursive: true })

const { CortexStore, readMeta, listSnapshots, readJsonl, FILES } = await import('../lib/store.js')
const { makeAdapters, capabilityReport } = await import('../lib/adapters.js')
const { makeCortex } = await import('../lib/pipeline.js')
const { extract } = await import('../lib/extract.js')
const { makeCell } = await import('../lib/schema.js')
const { applyWeights, entryThreshold } = await import('../lib/learning.js')
const { select } = await import('../lib/sparsity.js')
const { findInterference } = await import('../lib/overlap.js')
const { judge } = await import('../lib/judge.js')
const { counts: traceCounts } = await import('../lib/traces.js')
const { canWrite } = await import('../lib/write-window.js')
const { tierOf, archiveCold } = await import('../lib/hot-cold.js')
const { snapshot, rollback } = await import('../lib/version.js')
const fake = await import('./fake-organs.mjs')

const results = []
function check(name, fn) {
  return Promise.resolve()
    .then(fn)
    .then(() => results.push({ name, ok: true }))
    .catch((error) => results.push({ name, ok: false, error: String(error?.message || error) }))
}

const store = new CortexStore()
await store.init()
const meta = await readMeta()
const eps = fake.makeEpisodes()
const adapters = makeAdapters(null, { hippocampus: fake.makeHippocampus('normal', eps) })
const cortex = makeCortex({ store, adapters, meta })

// 1 抽取
await check('F20 抽取：uid/喜欢/关系 三条都出', () => {
  const cs = extract('我的B站uid是1000003，我喜欢喝拿铁，我妈叫王芳')
  assert.equal(cs.length, 3, JSON.stringify(cs.map((c) => c.predicate)))
})

// 2 噪声
await check('F20 噪声不抽', () => {
  assert.equal(extract('【这个抽屉：写插件】').length, 0)
})

// 2.1 威胁事件
await check('F20 威胁事件成条，不碎成地点', () => {
  const cs = extract('被领导叫去谈话，项目组要裁人，我整个人都懵了，手心一直出汗')
  assert.ok(cs.some((c) => c.kind === 'event'), JSON.stringify(cs.map((c) => c.kind)))
  assert.ok(!cs.some((c) => c.kind === 'place'))
})

// 2.2 地点只当标签
await check('F20 地点只当标签，不单独建档', () => {
  const cs = extract('我在楼下便利店买了瓶水')
  assert.ok(!cs.some((c) => c.kind === 'place'))
  assert.ok(cs.some((c) => (c.tags || []).some((t) => String(t).startsWith('place:'))))
})

// 2.2.1 同一句只留一条
await check('F20 同一句住院不重复抽成三条', () => {
  const cs = extract('我妈下午打电话说我爸住院了，下周要做手术')
  const texts = cs.map((c) => c.text)
  assert.equal(new Set(texts).size, texts.length, JSON.stringify(texts))
  assert.equal(cs.length, 1, JSON.stringify(cs.map((c) => c.kind)))
})

// 2.2.2 事件不互斥
await check('F28 裁员和住院不算冲突', async () => {
  const { classify } = await import('../lib/anti-pollution.js')
  const a = makeCell({ kind: 'event', subject: '主人', predicate: '经历', object: '裁员', text: '裁员' })
  const b = makeCell({ kind: 'event', subject: '主人', predicate: '经历', object: '住院', text: '住院' })
  assert.equal(classify(b, a), 'new')
})

// 2.2.3 希望/职责也不互斥；同一件事两种说法要合并
await check('F28 希望/职责不互斥，近似说法合并', async () => {
  const { classify } = await import('../lib/anti-pollution.js')
  const a = makeCell({ subject: '主人', predicate: '希望', object: '记忆不丢', text: '希望记忆不丢' })
  const b = makeCell({ subject: '主人', predicate: '希望', object: '表情包多点', text: '希望表情包多点' })
  assert.equal(classify(b, a), 'new')
  const c = makeCell({ subject: '主人', predicate: '负责', object: '记忆插件', text: '这个窗口以后只负责记忆插件' })
  const d = makeCell({ subject: '主人', predicate: '负责', object: '记忆插件', text: '这个窗口以后只负责记忆插件' })
  assert.equal(classify(d, c), 'same')
})

// 2.2.3 账号与职责模板
await check('F20 账号/职责模板能抽出来', () => {
  assert.ok(extract('B 站 uid 是 1000003').some((c) => c.predicate === '账号'))
  assert.ok(extract('以后这个窗口只负责 B 站智能回复插件').some((c) => c.predicate === '负责'))
})

// 2.2.4 中英混排归一
await check('F33 分词把“B 站”和“B站”归一', async () => {
  const { tokenize } = await import('../lib/util.js')
  assert.ok(tokenize('B 站').includes('b站'))
})

// 2.3 口语问法扩写
await check('F33 查询扩写：忙 → 正在做', async () => {
  const { expandQuery } = await import('../lib/match.js')
  assert.ok(expandQuery('她现在在忙什么').includes('正在做'))
  assert.ok(expandQuery('家里出什么事了').includes('经历'))
})

// 2.4 共性只收偏好
await check('F21 共性只收偏好，不把计划凑成规律', async () => {
  const { findPatterns } = await import('../lib/commonality.js')
  const cells = ['a', 'b', 'c'].map((o) => makeCell({ predicate: '计划', object: o, text: `计划${o}` }))
  assert.equal(findPatterns(cells).length, 0)
})

// 2.5 数据清理
await check('清理：碎地点/坏规律归档，正常 hypothesis 放回', async () => {  const { cleanupCells } = await import('../lib/cleanup.js')
  const cells = [
    makeCell({ id: 'a', kind: 'place', object: '楼下', tags: ['place'], state: 'hypothesis', archived: true }),
    makeCell({ id: 'b', predicate: '计划', text: '今天被领导叫去谈话，要裁人', state: 'hypothesis', archived: true }),
    makeCell({ id: 'c', predicate: '喜欢', object: '拿铁', text: '我喜欢拿铁', state: 'hypothesis', archived: true }),
    makeCell({ id: 'd', predicate: '计划', object: 'x', text: '计划x', tags: ['pattern'], state: 'fact' }),
  ]
  cleanupCells({ allCells: () => cells, put: () => {} })
  assert.equal(cells.find((c) => c.id === 'a').archived, true)
  assert.equal(cells.find((c) => c.id === 'b').archived, true)
  assert.equal(cells.find((c) => c.id === 'c').archived, false)
  assert.equal(cells.find((c) => c.id === 'd').archived, true)
})

// 2.6 历史导入不被 cursor 挡
await check('F35 拉数据按 distilled 去重，不看 cursor', async () => {
  const { shouldDistill } = await import('../lib/pipeline.js')
  const m = { cursor: Date.now(), distilled: { ep_done: 1 } }
  assert.equal(shouldDistill({ id: 'ep_old', state: 'closed' }, m), true)
  assert.equal(shouldDistill({ id: 'ep_done', state: 'closed' }, m), false)
  assert.equal(shouldDistill({ id: 'ep_open', state: 'open' }, m), false)
})

// 2.6 扩写按词分路，不拼长串
await check('F33 扩写按词分路：住院/裁人都能捞回', async () => {
  const { search } = await import('../lib/match.js')
  const cells = [
    makeCell({ id: 'x1', kind: 'event', text: '今天被领导叫去谈话，项目组要裁人', subject: '主人', predicate: '经历', object: '裁人' }),
    makeCell({ id: 'x2', kind: 'event', text: '我妈打电话说我爸住院了，下周要做手术', subject: '主人', predicate: '经历', object: '住院' }),
  ]
  const out = search(cells, '家里出什么事了', { k: 5 })
  assert.ok(out.hits.some((h) => h.cellId === 'x1'), '裁人那条要回来')
  assert.ok(out.hits.some((h) => h.cellId === 'x2'), '住院那条也要回来')
  assert.equal(out.hits[0].cellId, 'x2', '问家里时，家人住院要排第一')
})


// 3 巩固
let first = null
await check('F14 巩固：12 条 episode 全处理', async () => {
  first = await cortex.distill({ episodes: eps })
  assert.equal(first.processed, 12, JSON.stringify(first))
})

// 4 幂等
await check('R23 同一批再蒸馏不重复计数', async () => {
  const out = await cortex.distill({ episodes: eps })
  assert.equal(out.processed, 0)
})

// 5 证据升级
let uidCell = null
await check('F28 两条独立证据 → 假设升事实', () => {
  uidCell = store.allCells().find((c) => c.predicate === '账号')
  assert.ok(uidCell, 'should have account cell')
  assert.equal(uidCell.state, 'fact')
  assert.ok(uidCell.evidenceCount >= 2)
  assert.equal(uidCell.transferState, 'shadowed')
  assert.ok(['instance', 'type', 'rule'].includes(uidCell.level))
  // F37：显著性由杏仁核/规则给出并落盘
  assert.ok(uidCell.salience >= 0.4, `salience=${uidCell.salience}`)
})

// 6 多值偏好
await check('F06/R20 多值偏好不误判冲突', () => {
  const likes = store.allCells().filter((c) => c.predicate === '喜欢' && !c.tags?.includes('pattern'))
  assert.equal(likes.length, 3)
  const likeConflicts = store.conflicts.filter((c) => String(c.aText).includes('喜欢'))
  assert.equal(likeConflicts.length, 0)
})

// 7 冲突
await check('F45 手机号冲突被记录', () => {
  assert.ok(store.conflicts.length >= 1)
  assert.equal(store.conflicts[0].reason, 'value-mismatch')
})

// 8 图式偏差
await check('F24 与已确认事实冲突 → biasFlag', () => {
  const cell = store.allCells().find((c) => c.object === '13900000000')
  assert.ok(cell, 'should have conflicting phone')
  assert.equal(cell.biasFlag, true)
  assert.equal(cell.evidenceFlag, true)
})

// 9 共性
await check('F21 三个喜欢 → 一条规律', () => {
  const pattern = store.allCells().find((c) => c.tags?.includes('pattern') && c.predicate === '喜欢')
  assert.ok(pattern, 'should have pattern cell')
  assert.ok(pattern.object.includes('拿铁'))
})

// 10 精确检索
await check('F33 分离模式命中 uid', async () => {
  const out = await cortex.ask('1000003', { mode: 'separate' })
  assert.equal(out.mode, 'separate')
  assert.ok(out.hits.length >= 1)
})

// 11 补全检索
await check('F33 补全模式命中偏好', async () => {
  const out = await cortex.ask('喜欢喝什么')
  assert.ok(out.hits.length >= 1, JSON.stringify(out))
})

// 12 注入
await check('F40 注入带事实和 id', () => {
  const seg = cortex.inject()
  assert.ok(seg.text.includes('皮层'))
  assert.ok(seg.ids.length >= 1)
})

// 13 反馈
await check('F04 注入后回读能识别“不对”', async () => {
  const out = await cortex.observe('不对，你记错了')
  assert.ok(out.corrected.length >= 1)
})

// 14 人工纠错
await check('F46 纠错后不再召回', async () => {
  await cortex.correction(uidCell.id, 'test')
  const out = await cortex.ask('1000003', { mode: 'separate' })
  assert.ok(!out.hits.some((h) => h.cellId === uidCell.id))
})

// 14.1 校验只回 id 时 text 要补回来，answer 不能空
await check('F39 校验只回 id 时 ask 不空、answer 有字', async () => {
  const { makeCortex } = await import('../lib/pipeline.js')
  const target = store.allCells().find((c) => c.text.includes('喜欢'))
  assert.ok(target, 'should have a like cell')
  const picky = makeAdapters(null, {
    prefrontal: {
      v: 1,
      plan: async () => ({ mode: 'complete' }),
      verify: async () => ({ verdicts: [{ id: target.id, rank: 1, confidence: 0.5, flags: ['cold'] }], suppressed: [] }),
      truthfulness: async () => ({ score: 0.9 }),
    },
  })
  const c2 = makeCortex({ store, adapters: picky, meta })
  const out = await c2.ask('喜欢')
  assert.ok(out.hits.length >= 1)
  assert.ok(out.answer.length > 0)
  assert.ok(String(out.hits[0].text || '').length > 0, 'hit should carry text back')
})

// 15 冲突裁决
await check('F45 冲突能裁决', () => {
  const out = cortex.resolveConflict(0, 'a')
  assert.ok(out)
  assert.equal(out.state, 'resolved')
  assert.equal(out.winner, 'a')
})

await check('F45 造矛盾数据能验证冲突识别', async () => {
  const p = await cortex.conflictProbe()
  assert.equal(p.ok, true)
  assert.equal(p.kind, 'conflict')
  assert.ok(p.conflict)
})
await check('F31 老条目判冷、可归档', () => {
  const old = makeCell({ lastSeen: Date.now() - 100 * 86400000, confidence: 0.3, evidenceCount: 1 })
  assert.equal(tierOf(old), 'cold')
  assert.ok(archiveCold([old]).includes(old.id))
  assert.equal(old.archived, true)
})

// 16 归档恢复
await check('C5 归档可恢复', () => {
  const old = makeCell({ lastSeen: Date.now() - 100 * 86400000, confidence: 0.2, evidenceCount: 1 })
  store.put(old, { persist: false })
  archiveCold([old], Date.now())
  assert.equal(old.archived, true)
  const out = cortex.restore(old.id)
  assert.ok(out?.restored)
  assert.equal(store.get(old.id).archived, false)
})

// 17 权重顺序
await check('F09/R3 权重从基准重算，封顶 1.5', () => {
  const cell = makeCell({ evidenceCount: 3, lastSeen: Date.now() })
  const w1 = applyWeights(cell, { now: Date.now(), tier: 'hot' })
  const w2 = applyWeights(cell, { now: Date.now(), tier: 'hot' })
  assert.ok(w1 <= 1.5 && w1 > 0)
  assert.equal(w1, w2)
  // F23/R5：图式命中只降门槛，不抬步长
  assert.ok(entryThreshold(0.5, { schemaMatch: true }) < 0.5)
})

// 17 稀疏度
await check('F07 稀疏选择砍掉低分', () => {
  const picked = select([['a', 0.01], ['b', 0.5], ['c', 0.2]])
  assert.deepEqual(picked.map((x) => x[0]), ['b', 'c'])
})

// 18 重叠干扰
await check('F06 相似特征能测出干扰', () => {
  const a = makeCell({ text: '我喜欢喝拿铁', object: '拿铁', featureIds: ['f1', 'f2', 'f3'] })
  const b = makeCell({ text: '我喜欢喝美式', object: '美式', featureIds: ['f1', 'f2', 'f4'] })
  const out = findInterference([a, b], 0.2)
  assert.ok(out.length >= 1)
})

// 19 语义判定
await check('F42 同一件事/复述判定', () => {
  const a = makeCell({ id: 'a', text: '主人喜欢喝拿铁', subject: '主人', predicate: '喜欢', object: '拿铁', firstSeen: 1 })
  const b = makeCell({ id: 'b', text: '主人喜欢喝拿铁', subject: '主人', predicate: '喜欢', object: '拿铁', firstSeen: 2 })
  const out = judge(a, b)
  assert.equal(out.same, true)
  assert.equal(out.restatement, true)
})

// 20 概念召回
await check('F41 概念召回有结果', () => {
  const out = cortex.conceptRecall('喜欢', 5)
  assert.ok(out.items.length >= 1)
})

// 21 关系/层级/地点
await check('F43 层级与地点能输出', () => {
  assert.ok(cortex.hierarchy().length >= 1)
  assert.ok(cortex.places().includes('楼下便利店'), JSON.stringify(cortex.places()))
})

// 22 痕迹消费
await check('F44 痕迹能映射回 cell', () => {
  const rows = [{ episodeId: 'ep_0' }, { episodeId: 'ep_0' }, { episodeId: 'ep_2' }]
  const map = traceCounts(rows, store.allCells())
  assert.ok(map.size >= 1)
})

// 23 检索留痕
await check('F29 检索会写自己的 trace', async () => {
  await cortex.ask('喜欢', { k: 3 })
  await fake.sleep(80)
  const rows = await readJsonl(FILES.traces)
  assert.ok(rows.length >= 1, `traces=${rows.length}`)
})

// 23 慢器官
await check('R16 慢器官 200ms 超时不吃死', async () => {
  const slow = makeAdapters(null, { hippocampus: fake.makeHippocampus('slow', eps) })
  const t = Date.now()
  const out = await slow.hippocampus.episodes()
  assert.ok(Date.now() - t < 1500)
  assert.equal(out.length, 0)
})

// 24 版本不匹配
await check('R21 版本不匹配拒收，不崩', () => {
  const wrong = makeAdapters(null, { hippocampus: fake.makeHippocampus('wrongVersion', eps) })
  assert.equal(wrong.capabilities.hippocampus, false)
  assert.equal(wrong.capabilities.rejected.length, 1)
})

// 25 真实形状归一化
await check('R16 海马体真实形状归一化（at/quiet/traces）', async () => {
  const real = makeAdapters(null, {
    hippocampus: {
      v: 1,
      episodes: async () => [{ id: 'ep_at', at: 111, end: 222, summary: '我喜欢猫', state: 'closed' }],
      quiet: async () => ({ quiet: true }),
      traces: async () => ({ total: 1, at: Date.now(), recent: [{ episodeId: 'ep_at', at: Date.now() }] }),
    },
  })
  const eps2 = await real.hippocampus.episodes({})
  assert.equal(eps2[0].start, 111)
  assert.equal(eps2[0].end, 222)
  assert.equal(await real.hippocampus.quiet(), true)
  const tr = await real.hippocampus.traces()
  assert.ok(Array.isArray(tr) && tr.length === 1)
  assert.equal(real.capabilities.hippocampus, true)
})

// 25 写窗口
await check('F15 忙时不写', () => {
  assert.equal(canWrite({ lastActivityAt: Date.now() }), false)
  assert.equal(canWrite({ lastActivityAt: 0 }), true)
})

// 26 因果/时间边
await check('F30/F12 因果边与时间边都建了', () => {
  assert.ok(store.graph.some((e) => e.kind === 'causal'))
  assert.ok(store.graph.some((e) => e.kind === 'temporal'))
})

// 27 自检层级
await check('F34 单器官层级 L1', () => {
  assert.equal(cortex.health().level, 'L1')
  assert.equal(cortex.health().ok, true)
})

// 28 L3 组合
await check('F36/F37 接了前额叶+杏仁核 → L3', () => {
  const full = makeAdapters(null, {
    hippocampus: fake.makeHippocampus('normal', eps),
    prefrontal: fake.makePrefrontal('normal'),
    amygdala: fake.makeAmygdala('normal'),
  })
  assert.equal(capabilityReport(full).level, 'L3')
})

// 29 批上限与游标
await check('F18 批上限 20，游标只推进处理过的', async () => {
  const more = []
  const base = Date.now() - 60 * 1000
  for (let i = 0; i < 25; i++) {
    more.push({ id: `ep_x${i}`, start: base + i, end: base + i + 10, summary: `我喜欢测试${i}`, anchor: { sessionId: 's2' }, state: 'closed', version: 1 })
  }
  const out = await cortex.distill({ episodes: more })
  assert.equal(out.processed, 20)
  assert.equal(out.lastAt, more[19].start)
  const out2 = await cortex.distill({ episodes: more })
  assert.equal(out2.processed, 5)
})

// 30 回滚（放最后，会清空内存态）
await check('F13 快照回滚能回到零', async () => {
  const snaps = await listSnapshots()
  assert.ok(snaps.length >= 1)
  const out = await rollback(store, snaps[0])
  assert.ok(out)
  assert.equal(store.allCells().length, 0)
})

let pass = 0
for (const r of results) {
  if (r.ok) { pass += 1; console.log(`  ok  ${r.name}`) }
  else console.log(`  FAIL ${r.name}\n       ${r.error}`)
}
console.log(`\n${pass}/${results.length} passed`)
await rm(dir, { recursive: true, force: true }).catch(() => {})
process.exit(pass === results.length ? 0 : 1)
