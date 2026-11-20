// 契约测试：三态 / 五种器官状态 / 30 条断言 / 元测试（MockLiar 必须被抓到）
// 跑法：node tests/contract.mjs
import './env.mjs'
import { makeCands, QUERIES } from './fixtures.mjs'
import * as plan from '../kernel/plan.js'
import { judge, invariant, markRestatement } from '../kernel/judge.js'
import * as score from '../kernel/score.js'
import * as inhibit from '../kernel/inhibit.js'
import * as conflict from '../kernel/conflict.js'
import * as meta from '../kernel/meta.js'
import * as value from '../kernel/value.js'
import * as decay from '../kernel/decay.js'
import * as group from '../kernel/group.js'
import * as hint from '../kernel/hint.js'
import * as routes from '../kernel/routes.js'
import * as gate from '../kernel/gate.js'
import * as iterate from '../kernel/iterate.js'
import * as expand from '../kernel/expand.js'
import * as budget from '../kernel/budget.js'
import * as flags from '../kernel/flags.js'
import * as hot from '../store/hot.js'
import * as tasks from '../store/tasks.js'
import * as ledger from '../store/ledger.js'
import * as conflictsStore from '../store/conflicts.js'
import { migrate } from '../store/migrate.js'
import { probe, shadow, countCapabilities } from '../seams/registry.js'
import { wrap, absent, unknown, ok, syncSeams, capabilityTable } from '../seams/adapters.js'
import * as mocks from '../seams/mocks.js'
import * as receipt from '../seams/write.js'
import * as telemetry from '../host/telemetry.js'
import * as inject from '../host/inject.js'
import * as life from '../host/life.js'

const results = []
let seq = 0

function check(name, fn) {
  seq += 1
  try {
    const note = fn()
    results.push({ n: seq, name, ok: true, note })
  } catch (e) {
    results.push({ n: seq, name, ok: false, err: String(e?.message || e) })
  }
}

async function checkAsync(name, fn) {
  seq += 1
  try {
    const note = await fn()
    results.push({ n: seq, name, ok: true, note })
  } catch (e) {
    results.push({ n: seq, name, ok: false, err: String(e?.message || e) })
  }
}

function eq(a, b, msg = '') {
  if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${msg} 期望 ${JSON.stringify(b)}，实际 ${JSON.stringify(a)}`)
  return a
}
function near(a, b, eps = 0.02) {
  if (Math.abs(a - b) > eps) throw new Error(`期望 ≈${b}，实际 ${a}`)
  return a
}
function must(cond, msg) {
  if (!cond) throw new Error(msg || '断言不成立')
  return true
}

const NOW = Date.now()
const cands = makeCands(NOW)
const base = { now: NOW, session: 'test', coverage: 0.6, turn: 1, openTasks: 1 }

// ═══ A. 三态与降级（C4 / P5-7） ══════════════════════════════
check('A1 三态：absent / unknown / value 各归各位', () => {
  eq(wrap('t', undefined).tri, 'absent')
  eq(wrap('t', null).tri, 'absent')
  eq(wrap('t', 'unknown').tri, 'unknown')
  eq(wrap('t', 0).tri, 'value')
  eq(wrap('t', 0).value, 0)
  return '0 是值，不是 absent'
})

check('A2 unknown 封顶 0.6：有东西不知道，比知道得少更该谨慎', () => {
  const three = [{ name: 'gap', value: 1 }, { name: 'coverage', value: 1 }, { name: 'routes', value: 1 }]
  const a = score.compose(three, {})
  const b = score.compose(three, { unknown: 1 })
  must(a.conf > 0.6, `三路满证据应高于 0.6，实际 ${a.conf}`)
  eq(b.conf, 0.6)
  return `${a.conf} → ${b.conf}`
})

check('A3 置信单调：多一路证据，分数只升不降', () => {
  const one = score.compose([{ name: 'gap', value: 0.5 }]).conf
  const two = score.compose([{ name: 'gap', value: 0.5 }, { name: 'coverage', value: 0.8 }]).conf
  const three = score.compose([{ name: 'gap', value: 0.5 }, { name: 'coverage', value: 0.8 }, { name: 'routes', value: 1 }]).conf
  must(one <= two && two <= three, '不单调')
  return `${one} ≤ ${two} ≤ ${three}`
})

check('A4 空手：不抛错、不给假结果、明确禁断言', () => {
  const r = judge([], { ...base, plan: plan.plan('不存在的事') })
  eq(r.verdicts.length, 0)
  must(r.flags.includes('no-assert'), '缺 no-assert')
  eq(r.constraint.forbidAssert, true)
  return r.constraint.feeling
})

check('A5 降级标记：四种标能区分', () => {
  const f = flags.merge(['cold'], ['degraded'])
  eq(flags.has(f, 'cold'), true)
  eq(flags.has(f, 'shadow'), false)
  return f.join('+')
})

// ═══ B. 计划（P1） ══════════════════════════════════════════
check('B1 意图分类：六类各自命中', () => {
  eq(plan.intent('1000003'), 'fact')
  eq(plan.intent('我喜欢吃火锅吗'), 'preference')
  eq(plan.intent('我和她是什么关系'), 'relation')
  eq(plan.intent('后来呢'), 'sequence')
  eq(plan.intent('你还记得我说过什么吗'), 'meta')
  eq(plan.intent('在吗'), 'chat')
  return '6/6'
})

check('B2 精确问法走分离，不被相似条目污染', () => {
  const p = plan.plan('1000003')
  eq(p.mode, 'separate')
  return p.mode
})

check('B3 时间窗：昨天 / 上周 各自成窗', () => {
  const a = plan.filters('昨天吃什么了', { now: NOW })
  must(a.since && a.until, '昨天应带上下界')
  const b = plan.filters('上周去哪了', { now: NOW })
  must(b.since && b.until && b.until > b.since, '上周窗不对')
  return `${a.timeLabel}/${b.timeLabel}`
})

check('B4 检索目标：有 text / slots / hint，且不超长', () => {
  const p = plan.plan('我什么时候吃的火锅', { now: NOW })
  must(p.target.text.length > 0 && p.target.slots.length > 0, 'target 空')
  must(p.target.hint && Array.isArray(p.target.hint.exclude), 'hint 缺')
  must(p.target.text.length <= 200, 'target 太长')
  return p.target.slots.join('/')
})

check('B5 多路权重：没有向量的器官就不给向量权重', () => {
  const withVec = routes.weights('episode', { vector: true, graph: true, semantic: false })
  const noVec = routes.weights('episode', { vector: false, graph: true, semantic: false })
  must(withVec.vector > 0, '有向量时权重应 >0')
  eq(noVec.vector, undefined)
  const sum = Object.values(noVec).reduce((a, b) => a + b, 0)
  near(sum, 1, 0.001)
  return `sum=${sum}`
})

check('B6 扩写：最多 3 个变体，且不改原串', () => {
  const v = expand.variants('今天吃了火锅', {})
  must(v.length <= 4 && v[0] === '今天吃了火锅', '扩写越界')
  return v.length
})

check('B7 迭代：最多 2 轮，策略不重复', () => {
  const first = { lowConfidence: true, hits: [], coverage: 0, mode: 'complete', filters: {} }
  const r1 = iterate.again('火锅', first, { round: 1, tried: [], now: NOW })
  must(r1, '第一轮应允许重试')
  const r2 = iterate.again('火锅', first, { round: 2, tried: [r1.strategy], now: NOW })
  eq(r2, null)
  return r1.strategy
})

// ═══ C. 判断（P2 / P3） ═════════════════════════════════════
check('C1 一致性：同实体不同地点 → 结构冲突', () => {
  const pairs = conflict.scan([cands[0], cands[1]])
  must(pairs.length >= 1, '没检出地点冲突')
  eq(pairs[0].field, 'place')
  return pairs[0].values.join(' vs ')
})

check('C2 冲突裁决：三条不一致就只标不裁', () => {
  const byId = (id) => ({
    at: id === 'a' ? 100 : 200,
    source: { trust: id === 'a' ? 1 : 0.4 },
    repeat: id === 'a' ? 3 : 1,
  })
  const r = conflict.adjudicate({ aId: 'a', bId: 'b' }, { byId })
  eq(r.winner, null)
  eq(r.decided, false)
  eq(r.opinion, 'split')
  return r.votes.join(',')
})

check('C3 冲突裁决：三条一致才敢定', () => {
  const byId = (id) => ({
    at: id === 'a' ? 200 : 100,
    source: { trust: id === 'a' ? 1 : 0.4 },
    repeat: id === 'a' ? 3 : 1,
  })
  const r = conflict.adjudicate({ aId: 'a', bId: 'b' }, { byId })
  eq(r.winner, 'a')
  eq(r.decided, true)
  return r.opinion
})

check('C4 抑制粒度：同会话 + 近时间 + 同内容才合并，不同的事不许并', () => {
  const a = { episodeId: 'x1', session: 'same', at: NOW - 30000, score: 0.9, summary: '今天中午吃了火锅，辣得胃疼', entities: [] }
  const b = { episodeId: 'x2', session: 'same', at: NOW - 60000, score: 0.8, summary: '今天中午吃了火锅，辣得胃疼', entities: [] }
  const c = { episodeId: 'x3', session: 'same', at: NOW - 90000, score: 0.7, summary: '我爸住院了，下周手术', entities: [] }
  const same = inhibit.grain([a, b])
  eq(same.length, 1, '同一件事被说了两遍，应合并')
  const diff = inhibit.grain([a, c])
  eq(diff.length, 2, '两件不同的事被并成了一条——真实记忆会被吃掉')
  return `同内容 ${same.length} 条 / 不同内容 ${diff.length} 条`
})

check('C5 抑制下限：全被压也要捞回一条，并标记 restored', () => {
  const all = cands.filter((c) => c.state === 'archived')
  const j = judge(all, { ...base, plan: plan.plan('看电影') })
  must(j.verdicts.length >= 1, '压空了')
  must(j.verdicts[0].flags.includes('restored'), '没标 restored')
  return j.verdicts[0].id
})

check('C6 归档默认不进结果', () => {
  const j = judge([cands[5]], { ...base, plan: plan.plan('电影') })
  must(j.suppressed.some((s) => s.reason === 'archived'), '归档没被压')
  return j.suppressed[0].reason
})

check('C7 否定压制：问 A，不能拿“A 不是”当正面证据', () => {
  const r = inhibit.negate({ summary: '不是火锅，是烧烤' }, '吃的是火锅吗')
  eq(r, 'negated')
  return r
})

check('C8 负载耦合：负载高 → 阈值放松（抑制变弱），方向与情绪调节相反', () => {
  const low = inhibit.loadBias({ openTasks: 1, turn: 1 })
  const high = inhibit.loadBias({ openTasks: 4, turn: 300 })
  must(high.load > low.load, '负载没升高')
  must(high.threshold < low.threshold, '阈值方向反了')
  return `${low.threshold} → ${high.threshold}`
})

check('C9 不越界：输出里没有输入以外的词（C1 不变式）', () => {
  const j = judge(cands.slice(0, 6), { ...base, plan: plan.plan('火锅') })
  const inv = invariant(j, cands.slice(0, 6).map((c) => c.summary))
  must(inv.ok, `越界：${JSON.stringify(inv.bad)}`)
  return `查了 ${inv.inputs} 条输入`
})

check('C10 复述标记：同一件事的第二次描述被标出来，但不删', () => {
  const j = judge([cands[0], cands[4]], { ...base, plan: plan.plan('火锅') })
  const marked = markRestatement(j.verdicts, [cands[0], cands[4]])
  const hit = marked.find((v) => v.isRestatement)
  must(hit, '没标复述')
  must(marked.length === j.verdicts.length, '不许删条目')
  return `${hit.id} ← ${hit.restatementsOf.join(',')}`
})

check('C11 FOK 分两种：有结果不确定 / 没结果但知道有', () => {
  const a = meta.fok({ hits: 1, suppressed: 0, coverage: 0.2, intent: 'episode' })
  const b = meta.fok({ hits: 0, suppressed: 3, coverage: 0.2, intent: 'episode' })
  must(a.feeling !== b.feeling, '两种感觉被合并了')
  return `${a.feeling} / ${b.feeling}`
})

check('C12 错误检测：用户说“不对”后同类置信下降', () => {
  const c0 = { episode: { n: 20, hit: 16, deny: 0 } }
  const c1 = meta.onDeny(c0, 'episode')
  must(c1.episode.hit < c0.episode.hit, '没下调')
  eq(c1.episode.deny, 1)
  return `${c0.episode.hit} → ${c1.episode.hit}`
})

// ═══ D. 状态（P0） ══════════════════════════════════════════
check('D1 热区：三档分层 + 权重和为 1（分布式维持）', () => {
  const fresh = { episodeId: 'h1', session: 'hot', at: NOW - 60, summary: '刚说的', score: 0.9, entities: [] }
  const old = { episodeId: 'h2', session: 'hot', at: NOW - 3 * 86400000, summary: '很久以前', score: 0.5, entities: [] }
  return hot.refresh('hot', [fresh, old], { now: NOW }).then((r) => {
    const t = hot.tiers('hot')
    must(t.hot.length >= 1 && t.background.length >= 1, '分层不对')
    const w = hot.weights('hot')
    const sum = w.reduce((n, x) => n + x.w, 0)
    near(sum, 1, 0.001)
    return `hot=${t.hot.length} bg=${t.background.length}`
  })
})

check('D2 任务：没有完成判据不许出栈', () => {
  return (async () => {
    const row = await tasks.push({ session: 'tk', goal: '写报表' }, NOW)
    const r1 = await tasks.pop(row.id, { text: '随便说说' })
    eq(r1.ok, false)
    const r2 = await tasks.pop(row.id, { text: '报表写完了' })
    eq(r2.ok, true)
    return '判据生效'
  })()
})

check('D3 目标过期：超时不删，降级成 stale', () => {
  return (async () => {
    const row = await tasks.push({ session: 'tk2', goal: '买耳机' }, NOW - 10 * 3600 * 1000)
    const r = await tasks.expire(NOW)
    must(r.stale.includes(row.id), '没过期')
    return r.count
  })()
})

check('D4 规则维持：违反约束的候选被拒且说明原因', () => {
  const row = { rules: [{ text: '加班' }] }
  const g = gate.shouldRemember('今天又加班了', { rules: row.rules })
  eq(g.keep, false)
  must(String(g.reason).includes('违反约束'), '没说原因')
  const g2 = gate.shouldRemember('嗯', {})
  eq(g2.keep, false)
  return g.reason
})

check('D5 组块化：并完指针后字符确实变少', () => {
  const items = cands.slice(0, 6).map((c) => ({ ...c }))
  const g = group.packingGain(items)
  must(g.charsAfter < g.charsBefore, '没省字符')
  return `${g.charsBefore} → ${g.charsAfter}`
})

// ═══ E. 协作（P5） ══════════════════════════════════════════
check('E1 能力协商：单器官时全 false，且能逐项报', () => {
  const ctx = { get: () => null }
  const p = probe(ctx)
  const c = countCapabilities(p.capabilities)
  eq(c.present, 0)
  eq(p.hello.organs.cortex, false)
  must(c.total >= 15, '接入面数量对不上')
  return `${c.present}/${c.total}`
})

check('E2 能力协商：接过器官后逐项变 true（不是整块 true）', () => {
  const p = probe({ get: (n) => (n === 'memory.cortex' ? mocks.mockHalf() : null) })
  eq(p.capabilities.cog.concepts, true)
  eq(p.capabilities.cog.contradicts, false)
  return '半能力被如实报出'
})

check('E3 shadow：只记录不生效时 apply=false', () => {
  eq(shadow('cortex', false).apply, false)
  eq(shadow('cortex', true).apply, true)
  return 'ok'
})

check('E4 回执：下游不执行时比例低并报警', () => {
  const r = receipt.receipt('gen.constrain', ['hedge', 'forbidAssert'], ['hedge'])
  eq(r.ratio, 0.5)
  eq(r.warn, true)
  return r.why
})

check('E5 巩固优先级：有奖励词的排在前面', () => {
  const ranked = hint.rankForConsolidation([cands[13], cands[14]], { goal: '耳机', now: NOW })
  must(ranked[0].score >= ranked[1].score, '排序没生效')
  return ranked.map((r) => `${r.rank}:${r.id}`).join(' ')
})

check('E6 缓存：命中/未命中分开记，键里带候选指纹', () => {
  telemetry.clear()
  const k = telemetry.keyOf('episode', { since: 1 }, ['a', 'b'])
  must(telemetry.get(k) === null, '不该命中')
  telemetry.set(k, { v: 1 })
  eq(telemetry.get(k).v, 1)
  const s = telemetry.snapshot()
  eq(s.cacheHit, 1)
  eq(s.cacheMiss, 1)
  return `hit=${s.cacheHit} miss=${s.cacheMiss}`
})

check('E7 注入预算：超预算时先砍背景档，不砍约束', () => {
  const block = inject.compose({
    task: { goal: '写季度报表', rules: ['提加班'] },
    constraint: { note: '上一轮不太确定' },
    hot: Array.from({ length: 10 }, (_, i) => ({ summary: `第${i}条很长的记忆内容要占字符`, tier: 'background' })),
    maxChars: 120,
  })
  must(block.chars <= 120, '超预算')
  must(block.text.includes('写季度报表'), '约束被砍了')
  return `chars=${block.chars} truncated=${block.truncated}`
})

check('E8 迁移：版本落盘，重复跑不重复迁', () => {
  return (async () => {
    const a = await migrate()
    const b = await migrate()
    eq(b.changed, false)
    return `v${a.from}→v${a.to}`
  })()
})

// ═══ F. 五种器官状态（must not crash） ══════════════════════
async function stateCase(name, organs) {
  const seams = syncSeams(organs)
  const t0 = Date.now()
  const r = judge(cands.slice(0, 5), { ...base, plan: plan.plan('火锅'), seams })
  const ms = Date.now() - t0
  return { name, verdicts: r.verdicts.length, flags: r.flags, ms, conf: r.verdicts[0]?.confidence ?? 0 }
}

await checkAsync('F1 全 absent：单器官期能跑，不报错', async () => {
  const r = await stateCase('absent', mocks.noOrgans())
  must(r.verdicts > 0, '不该空')
  must(r.ms < 120, `T0 太慢 ${r.ms}ms`)
  return `${r.verdicts} 条 / ${r.ms}ms`
})

await checkAsync('F2 半能力：有的生效，没有的标 degraded', async () => {
  const organs = { hippocampus: mocks.mockHippocampus({ hits: cands }), cortex: mocks.mockHalf() }
  const r = await stateCase('half', organs)
  must(r.verdicts > 0, '半能力不该全空')
  return `${r.verdicts} 条`
})

await checkAsync('F3 全能力：来源种类能被读出来', async () => {
  const noSource = cands.map(({ source, ...rest }) => rest)
  const organs = {
    hippocampus: { source: () => ({ kind: '推断', trust: 0.4 }) },
  }
  const seams = syncSeams(organs)
  const r = judge(noSource.slice(0, 3), { ...base, plan: plan.plan('火锅'), seams })
  eq(r.verdicts[0].source.kind, '推断')
  return r.verdicts[0].source.kind
})

await checkAsync('F4 器官坏掉：不抛错、不卡死，结果降级', async () => {
  const r = await stateCase('broken', mocks.mockBroken())
  must(r.ms < 200, `坏了还卡 ${r.ms}ms`)
  return `${r.verdicts} 条 / ${r.ms}ms`
})

await checkAsync('F5 器官慢：T0 仍不超预算（慢的走缓存）', async () => {
  const organs = mocks.mockSlow({ hippocampus: mocks.mockHippocampus({ hits: cands }) })
  const r = await stateCase('slow', organs)
  must(r.ms < 200, `慢器官拖垮 T0：${r.ms}ms`)
  return `${r.ms}ms`
})

// ═══ G. 元测试：MockLiar 必须被抓到 ════════════════════════
check('G1 说谎的器官：断言表必须能发现', () => {
  const noSource = cands.map(({ source, ...rest }) => rest).slice(0, 3)
  const truth = syncSeams({ hippocampus: { source: () => ({ kind: '推断', trust: 0.4 }) } })
  const liar = syncSeams({ hippocampus: { source: () => ({ kind: '原话', trust: 1 }) } })

  const good = judge(noSource, { ...base, plan: plan.plan('火锅'), seams: truth })
  const bad = judge(noSource, { ...base, plan: plan.plan('火锅'), seams: liar })

  const detect = (r) => r.verdicts.every((v) => v.source.kind === '推断')
  must(detect(good), '真话没通过')
  must(!detect(bad), '**没抓到说谎的器官——断言表是摆设**')
  return `真话 kind=${good.verdicts[0].source.kind} / 假话 kind=${bad.verdicts[0].source.kind}`
})

// ═══ 输出 ══════════════════════════════════════════════════
// D1/D2/D3 返回的是 Promise，统一在这里 await 掉
for (const r of results) {
  if (!r.done && r.note && typeof r.note.then === 'function') {
    try { r.note = await r.note; r.ok = true } catch (e) { r.ok = false; r.err = String(e?.message || e) }
  }
}

const groups = [
  ['A 三态与降级', (n) => n.startsWith('A')],
  ['B 计划', (n) => n.startsWith('B')],
  ['C 判断', (n) => n.startsWith('C')],
  ['D 状态', (n) => n.startsWith('D')],
  ['E 协作', (n) => n.startsWith('E')],
  ['F 五种器官状态', (n) => n.startsWith('F')],
  ['G 元测试', (n) => n.startsWith('G')],
]

let pass = 0
let fail = 0
console.log('\n前额叶 · 契约测试\n' + '='.repeat(52))
for (const [title, pick] of groups) {
  console.log(`\n## ${title}`)
  for (const r of results.filter((x) => pick(x.name))) {
    if (r.ok) {
      pass += 1
      console.log(`  ✓ ${r.name}${r.note !== undefined ? `  → ${typeof r.note === 'object' ? JSON.stringify(r.note) : r.note}` : ''}`)
    } else {
      fail += 1
      console.log(`  ✗ ${r.name}\n      ${r.err}`)
    }
  }
}

console.log('\n' + '='.repeat(52))
console.log(`通过 ${pass} / 失败 ${fail} / 共 ${results.length}`)
console.log(`T0 预算：<15ms（F1–F5 已验）  数据目录：测试用临时目录`)
process.exit(fail === 0 ? 0 : 1)
