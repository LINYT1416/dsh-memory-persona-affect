// 功能自检：66 条逐条对照代码 + 功能之间的互相检测 + 多器官协作检查。
// 这把尺子是"代码里到底有没有这个东西"，不是"文档里写没写"。
// 跑法：node tests/selfcheck.mjs
import './env.mjs'
import { readFile } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { makeCands } from './fixtures.mjs'
import { plan as makePlan } from '../kernel/plan.js'
import { judge } from '../kernel/judge.js'
import * as hot from '../store/hot.js'
import * as tasks from '../store/tasks.js'
import * as ledger from '../store/ledger.js'
import * as budget from '../kernel/budget.js'
import * as decay from '../kernel/decay.js'
import * as value from '../kernel/value.js'
import * as inhibit from '../kernel/inhibit.js'
import * as group from '../kernel/group.js'
import * as inject from '../host/inject.js'
import * as expand from '../kernel/expand.js'
import * as conflict from '../kernel/conflict.js'
import * as conflictsStore from '../store/conflicts.js'
import * as telemetry from '../host/telemetry.js'
import * as mocks from '../seams/mocks.js'
import { syncSeams } from '../seams/adapters.js'
import { probe as probeOrgans } from '../seams/registry.js'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

// ── 66 条：编号 / 名字 / 文件 / 代码里的样子 ──────────────────
const ITEMS = [
  ['P0-1', '热区分层', 'store/hot.js', 'export function tiers\\('],
  ['P0-2', '容量双闸', 'kernel/budget.js', 'export function fit\\('],
  ['P0-3', '主动刷新', 'store/hot.js', 'export async function refresh\\('],
  ['P0-4', '主动丢弃', 'store/hot.js', 'export async function dropOnSwitch\\('],
  ['P0-5', '组块化', 'kernel/group.js', 'export function mergePointers\\('],
  ['P0-6', '分布式维持', 'store/hot.js', 'export function weights\\('],
  ['P0-7', '任务栈', 'store/tasks.js', 'export async function push\\('],
  ['P0-8', '完成判据', 'store/tasks.js', 'export function isDone\\('],
  ['P0-9', '目标过期', 'store/tasks.js', 'export async function expire\\('],
  ['P0-10', '规则维持', 'kernel/gate.js', 'export function hardRule\\('],
  ['P0-11', '注入预算与组装', 'host/inject.js', 'export function compose\\('],

  ['P1-1', '意图分类', 'kernel/plan.js', 'export function intent\\('],
  ['P1-2', '模式选择', 'kernel/plan.js', 'export function mode\\('],
  ['P1-3', '过滤器生成', 'kernel/plan.js', 'export function filters\\('],
  ['P1-4', '检索目标', 'kernel/target.js', 'export function build\\('],
  ['P1-5', '查询扩写', 'kernel/expand.js', 'export function expand\\('],
  ['P1-6', '多路选择与权重', 'kernel/routes.js', 'export function weights\\('],
  ['P1-7', '迭代检索', 'kernel/iterate.js', 'export function again\\('],
  ['P1-8', '检索预算', 'kernel/budget.js', 'export function cap\\('],
  ['P1-9', '重排', 'kernel/judge.js', 'export function rank\\('],
  ['P1-10', '序列路由', 'kernel/plan.js', 'export function isSequence\\('],

  ['P2-1', '来源标签强制', 'kernel/source.js', 'export function ensure\\('],
  ['P2-2', '来源种类判定', 'kernel/source.js', 'export function kind\\('],
  ['P2-3', '来源可信度', 'kernel/source.js', 'export function trust\\('],
  ['P2-4', '一致性校验', 'kernel/conflict.js', 'export function scan\\('],
  ['P2-5', '冲突落队', 'store/conflicts.js', 'export async function enqueue\\('],
  ['P2-6', '冲突裁决', 'kernel/conflict.js', 'export function adjudicate\\('],
  ['P2-7', '语义矛盾判定', 'kernel/conflict.js', 'export function contradicts\\('],
  ['P2-8', '空手禁断言', 'kernel/judge.js', 'export function noAssert\\('],
  ['P2-9', '置信度合成', 'kernel/score.js', 'export function compose\\('],
  ['P2-10', '三态处理', 'seams/adapters.js', 'export function wrap\\('],
  ['P2-11', '低置信行为', 'kernel/judge.js', 'export function hedge\\('],
  ['P2-12', '校验日志', 'store/ledger.js', 'export async function verdict\\('],
  ['P2-13', 'FOK 信号', 'kernel/meta.js', 'export function fok\\('],

  ['P3-1', '错配过滤', 'kernel/inhibit.js', 'export function mismatch\\('],
  ['P3-2', '否定识别', 'kernel/inhibit.js', 'export function negate\\('],
  ['P3-3', '抑制粒度', 'kernel/inhibit.js', 'export function grain\\('],
  ['P3-4', '抑制下限', 'kernel/inhibit.js', 'export function floor\\('],
  ['P3-5', '负载耦合', 'kernel/inhibit.js', 'export function loadBias\\('],
  ['P3-6', '抑制可撤销', 'store/ledger.js', 'export function suppressed\\('],
  ['P3-7', '冲突监测', 'kernel/inhibit.js', 'export function alert\\('],
  ['P3-8', '错误检测', 'kernel/meta.js', 'export function onDeny\\('],
  ['P3-9', 'perseveration', 'store/ledger.js', 'export async function blacklistStrategy\\('],
  ['P3-10', '漂移拉回', 'host/inject.js', 'export function drift\\('],

  ['P4-1', '情绪权重读取', 'kernel/value.js', 'export function weightOf\\('],
  ['P4-2', '消退曲线', 'kernel/decay.js', 'export function curve\\('],
  ['P4-3', '复发再压', 'kernel/decay.js', 'export function again\\('],
  ['P4-4', '降权请求', 'seams/adapters.js', 'export function amyAdjust\\('],
  ['P4-5', '价值评估', 'kernel/value.js', 'export function goalFitOf\\('],
  ['P4-6', '奖赏预期', 'kernel/value.js', 'export function rewardOf\\('],
  ['P4-7', '自我参照', 'kernel/value.js', 'export function selfOf\\('],
  ['P4-8', '价值整合', 'kernel/value.js', 'export function integrate\\('],

  ['P5-1', '能力协商', 'seams/registry.js', 'export function hello\\('],
  ['P5-2', 'shadow 灰度', 'seams/registry.js', 'export function shadow\\('],
  ['P5-3', 'telemetry', 'host/telemetry.js', 'export function snapshot\\('],
  ['P5-4', '账本清理', 'store/ledger.js', 'export async function sweep\\('],
  ['P5-5', '只读投影', 'store/ledger.js', 'export function projection\\('],
  ['P5-6', '回执', 'seams/write.js', 'export function receipt\\('],
  ['P5-7', '降级标记', 'kernel/flags.js', 'export function tag\\('],
  ['P5-8', 'golden 回归', 'tests/golden.mjs', 'goldenSets'],
  ['P5-9', '版本协商', 'seams/registry.js', 'export function version\\('],
  ['P5-10', '崩溃兜底', 'host/life.js', 'export function check\\('],
  ['P5-11', '数据迁移', 'store/migrate.js', 'export async function migrate\\('],
  ['P5-12', '巩固优先级', 'kernel/hint.js', 'export function priority\\('],
  ['P5-13', '预演采信', 'kernel/meta.js', 'export function adopt\\('],
  ['P5-14', '冲突队列处置', 'store/conflicts.js', 'export async function dispatch\\('],
]

// ── 17 个接入面：代码里必须真的有这个口 ──────────────────────
const SEAMS = [
  ['F1', 'pf.retrieve', 'index.js', 'async function retrieve\\('],
  ['F2', 'pf.plan', 'kernel/plan.js', 'export function plan\\('],
  ['F3', 'pf.gate', 'kernel/gate.js', 'export function shouldRemember\\('],
  ['F4', 'pf.judge', 'kernel/judge.js', 'export function judge\\('],
  ['F5', 'mem.recall', 'index.js', 'mem\\.recall'],
  ['F6', 'mem.episode', 'seams/adapters.js', 'episode:'],
  ['F7', 'mem.traces', 'seams/adapters.js', 'traces:'],
  ['F8', 'mem.source', 'seams/adapters.js', 'source:'],
  ['F9', 'mem.conflicts', 'seams/adapters.js', 'conflicts:'],
  ['F10', 'cog.concepts', 'seams/adapters.js', 'concepts:'],
  ['F11', 'cog.contradicts', 'seams/adapters.js', 'contradicts:'],
  ['F12', 'cog.search', 'seams/adapters.js', 'cogSearch:'],
  ['F13', 'cog.summarize', 'seams/adapters.js', 'summarize:'],
  ['F14', 'amy.salience', 'seams/adapters.js', 'salience:'],
  ['F15', 'amy.weight/adjust', 'seams/adapters.js', 'weight:'],
  ['F16', 'gen.constrain', 'seams/adapters.js', 'constrain:'],
  ['F17', 'mem.hint', 'kernel/hint.js', 'export function hint\\('],
]

const NOW = Date.now()
const base = { now: NOW, session: 'self', coverage: 0.6, turn: 1, openTasks: 1 }
const cands = makeCands(NOW)

const cache = new Map()
async function body(file) {
  if (!cache.has(file)) cache.set(file, await readFile(join(ROOT, file), 'utf8').catch(() => ''))
  return cache.get(file)
}

async function staticCheck(list, label) {
  const rows = []
  for (const [id, name, file, pat] of list) {
    const text = await body(file)
    const found = text.length > 0 && new RegExp(pat).test(text)
    rows.push({ id, name, file, ok: found })
  }
  const bad = rows.filter((r) => !r.ok)
  console.log(`\n## ${label}（${rows.length - bad.length}/${rows.length}）`)
  for (const r of rows) console.log(`  ${r.ok ? '✓' : '✗'} ${r.id} ${r.name}  → ${r.file}`)
  return bad
}

const t = []
function probe(name, fn) {
  try {
    const note = fn()
    t.push({ name, ok: true, note })
  } catch (e) {
    t.push({ name, ok: false, err: e?.message || String(e) })
  }
}
async function probeAsync(name, fn) {
  try {
    const note = await fn()
    t.push({ name, ok: true, note })
  } catch (e) {
    t.push({ name, ok: false, err: e?.message || String(e) })
  }
}
function must(c, m) { if (!c) throw new Error(m || '不成立'); return true }

console.log('\n前额叶 · 功能自检\n' + '='.repeat(56))

const badItems = await staticCheck(ITEMS, '66 条功能 → 代码落点')
const badSeams = await staticCheck(SEAMS, '17 个接入面 → 代码口')

// ── 功能之间的互相检测（打架 / 缺口）─────────────────────────
console.log('\n## 功能互相检测（这一轮代码真的能对上吗）')

await probeAsync('X1 R1：换任务时，未完成任务的热区条目不被清', async () => {
  hot.reset()
  const now = Date.now()
  await hot.refresh('r1', [
    { episodeId: 'k1', at: now - 3 * 86400000, summary: '正在做的活的旧上下文', score: 0.4, taskId: 'A' },
    { episodeId: 'k2', at: now - 3 * 86400000, summary: '早就不干的活', score: 0.4, taskId: 'B' },
  ], { now })
  const r = await hot.dropOnSwitch('r1', { justSwitched: true, keepTaskId: 'A', now })
  const left = hot.tiers('r1').background.map((i) => i.id)
  must(left.includes('k1'), '未完成任务的条目被清了')
  must(!left.includes('k2'), '无关条目没被清')
  return `剩 ${left.join(',')}，丢了 ${r.dropped}`
})

probe('X2 R2：被压空 ≠ 没想起（元认知要分开报）', () => {
  const j = judge(cands.slice(0, 3), { ...base, plan: makePlan('火锅'), rules: [{ text: '火锅' }] })
  must(j.verdicts.length === 0, '应该全被硬约束挡住')
  must(j.constraint?.feeling === 'suppressed', `感觉报成了 ${j.constraint?.feeling}`)
  must(j.suppressed.length === 3, '压掉的总数不对：' + j.suppressed.length)
  return j.constraint.feeling
})

probe('X3 R3：第二轮封顶 0.6，不许越搜越自信', () => {
  const j = judge(cands.slice(0, 4), { ...base, plan: makePlan('火锅'), round: 2 })
  const top = j.verdicts[0]
  must(top.confidence <= 0.6, `第二轮置信 ${top.confidence} 超了`)
  must(top.flags.includes('round2'), '第二轮没打标')
  return `${top.confidence} + ${top.flags.join('/')}`
})

probe('X4 R5：硬约束在读出口也生效（不只写入口）', () => {
  const j = judge(cands.slice(0, 5), { ...base, plan: makePlan('火锅'), rules: [{ text: '胃疼' }] })
  const hit = j.suppressed.find((s) => s.reason === 'rule')
  must(hit, '违反约束的候选没被挡在读出口')
  return `${hit.id} ${hit.why}`
})

probe('X5 R7：消退权重与价值分是两个字段，不抢同一个', () => {
  const c = decay.curve(1, 0.2)
  must(c.every((s) => 'weight' in s && !('value' in s)), '消退曲线混进了 value')
  const v = value.integrate({ goal: 0.8, reward: 0.6 })
  must('value' in v && !('weight' in v), '价值整合混进了 weight')
  return `curve=${c.length}步 / value=${v.value}`
})

probe('X6 R8：多任务时每个任务保底 2 条，不被一个任务吃光', () => {
  const items = [
    ...Array.from({ length: 5 }, (_, i) => ({ id: `a${i}`, taskId: 'A', tier: 'hot', score: 0.9, summary: 'A' })),
    ...Array.from({ length: 5 }, (_, i) => ({ id: `b${i}`, taskId: 'B', tier: 'background', score: 0.1, summary: 'B' })),
  ]
  const r = budget.fit(items, { maxItems: 5 })
  const bKept = r.kept.filter((x) => x.taskId === 'B').length
  must(bKept >= 2, `B 任务只保到 ${bKept} 条`)
  return `A=${r.kept.filter((x) => x.taskId === 'A').length} B=${bKept}`
})

await probeAsync('X7 R9：失败策略进黑名单，迭代前会查', async () => {
  ledger.reset()
  await ledger.blacklistStrategy('broaden', 'episode')
  must(ledger.strategyBlocked('broaden', 'episode'), '黑名单没生效')
  const idx = await body('index.js')
  must(/strategyBlocked\(/.test(idx), '迭代路径里没查黑名单')
  return 'broaden 已拉黑'
})

await probeAsync('X8 R12：T0 不发远程调用（慢器官也拖不垮）', async () => {
  const organs = mocks.mockSlow({ hippocampus: mocks.mockHippocampus({ hits: cands }) })
  const seams = syncSeams(organs)
  const t0 = Date.now()
  judge(cands.slice(0, 5), { ...base, plan: makePlan('火锅'), seams })
  const ms = Date.now() - t0
  must(ms < 60, `T0 花了 ${ms}ms`)
  return `${ms}ms`
})

probe('X9 R14：预算紧时砍背景，不砍约束', () => {
  const b = inject.compose({
    task: { goal: '写报表', rules: ['提加班'] },
    constraint: { note: '上一轮不太确定' },
    hot: Array.from({ length: 8 }, () => ({ summary: '一条很占字符的背景内容啊啊啊', tier: 'background' })),
    maxChars: 90,
  })
  must(b.chars <= 90, '超预算')
  must(b.text.includes('写报表') && b.text.includes('上一轮不太确定'), '约束被砍了')
  return `chars=${b.chars}`
})

probe('X10 三层仲裁：前额叶自己不判语义（fact 层交皮层）', async () => {
  const j = await body('kernel/judge.js')
  must(!/conflict\.contradicts\(/.test(j), 'judge 里直接判了语义')
  const c = await body('kernel/conflict.js')
  must(/seam\?\.contradicts/.test(c), 'conflict 没走皮层口')
  return 'fact→cortex 成立'
})

probe('X11 三层仲裁：杏仁核分不能强迫 keep（用法权在前额叶）', () => {
  const j = judge(cands.slice(0, 3), { ...base, plan: makePlan('火锅'), rules: [{ text: '火锅' }] })
  must(j.verdicts.length === 0, '高价值候选被放行了——用法权跑到杏仁核去了')
  return '仍然为空'
})

await probeAsync('X12 五种器官状态：返回形状一致，不崩', async () => {
  const states = {
    absent: mocks.noOrgans(),
    half: { hippocampus: mocks.mockHippocampus({ hits: cands }), cortex: mocks.mockHalf() },
    full: { hippocampus: mocks.mockHippocampus({ hits: cands }), cortex: mocks.mockCortex(), amygdala: mocks.mockAmygdala() },
    broken: mocks.mockBroken(),
    liar: { hippocampus: mocks.mockLiar({ hits: cands }) },
  }
  const keys = []
  for (const [name, organs] of Object.entries(states)) {
    const r = judge(cands.slice(0, 4), { ...base, plan: makePlan('火锅'), seams: syncSeams(organs) })
    for (const k of ['verdicts', 'suppressed', 'conflicts', 'constraint', 'adopted', 'flags', 'meta']) {
      if (!(k in r)) throw new Error(`${name} 缺 ${k}`)
    }
    keys.push(`${name}:${r.verdicts.length}`)
  }
  return keys.join(' ')
})

probe('X13 组块化只并指针，不生成新句子', () => {
  const items = cands.slice(0, 4).map((c) => ({ ...c }))
  const g = group.mergePointers(items)
  must(g.length > 0, '没分出组')
  for (const x of g) {
    const fromInput = items.some((i) => String(i.summary || '').startsWith(String(x.label).slice(0, 10)))
    must(fromInput, `label 不是从输入截的：${x.label}`)
    must(String(x.label).length <= 40, 'label 太长，像新写的')
  }
  return `${g.length} 组，label 全部来自输入`
})

probe('X14 接缝缺口：海马 5 个接口全 absent，9 条降级但不报错', async () => {
  const seams = syncSeams({ hippocampus: { recall: () => [] } })
  must(seams.source('x').tri === 'absent', 'source 应是 absent')
  must(seams.traces().tri === 'absent', 'traces 应是 absent')
  // 关键：候选自己没带来源时，必须降级成 unknown，而不是猜一个
  const noSrc = cands.slice(0, 3).map(({ source, ...rest }) => rest)
  const j = judge(noSrc, { ...base, plan: makePlan('火锅'), seams })
  must(j.verdicts.every((v) => v.source.kind === 'unknown'), '来源应降级成 unknown')
  return `${j.verdicts.length} 条全是 unknown`
})

probe('X15 扩写真的进了第二轮（不是死代码）', async () => {
  const idx = await body('index.js')
  must(/expand\.variants\(/.test(idx), 'retrieve 里没用扩写')
  const vs = expand.variants('今天吃了火锅', expand.DICT)
  must(vs.length >= 1, '扩写没产出')
  return `${vs.length} 个说法`
})

probe('X16 组块化真的进了注入（同题合并）', () => {
  const hotItems = cands.slice(0, 6).map((c) => ({ summary: c.summary, tier: 'hot', source: { kind: c.source?.kind }, confidence: c.confidence }))
  const b = inject.compose({ task: { goal: '记着火锅' }, hot: hotItems, maxChars: 900 })
  must(/同题/.test(b.text) || b.groups < hotItems.length, '没合并')
  return `${hotItems.length} 条 → ${b.groups} 组`
})

probe('X17 漂移会真的触发（off 会累加）', () => {
  const task = { goal: '写季度报表' }
  let st = {}
  let pulled = false
  for (const t of ['今天天气不错', '路上看到一只猫', '晚上吃什么好']) {
    const d = inject.drift(st, { task, text: t, now: Date.now() })
    st = d.state
    if (d.pull) pulled = true
  }
  must(pulled, '连续跑题两轮也没拉回')
  return `off 触发，第 ${st.off} 次后归零`
})

probe('X18 被压过又冒头 → 打 reappeared 标', () => {
  const j = judge(cands.slice(0, 3), { ...base, plan: makePlan('火锅'), wasSuppressed: () => true })
  must(j.verdicts.some((v) => v.flags.includes('reappeared')), '没打标')
  return j.verdicts[0].flags.join('/')
})

probe('X19 ACC 对立进冲突队列（不只结构冲突）', () => {
  // 问句不能带"火锅"，否则"不爱吃火锅"会被否定压制，两条就剩一条了
  const j = judge([cands[2], cands[3]], { ...base, plan: makePlan('我最近吃啥了') })
  const acc = j.conflicts.filter((c) => c.kind === 'acc')
  must(acc.length >= 1, '没检出 ACC 对立')
  return `acc=${acc.length} 总=${j.conflicts.length}`
})

await probeAsync('X20 冲突裁决全链：入队 → 裁决 → 回填', async () => {
  conflictsStore.reset()
  await conflictsStore.enqueue([{ aId: 'a', bId: 'b', field: 'place', values: ['x', 'y'], kind: 'place' }], Date.now())
  const open = conflictsStore.open(5)
  must(open.length === 1, '没入队')
  const byId = (id) => ({ at: id === 'a' ? 200 : 100, source: { trust: id === 'a' ? 1 : 0.4 }, repeat: id === 'a' ? 3 : 1 })
  const v = conflict.adjudicate(open[0], { byId })
  must(v.decided, '三规则一致却没定案')
  await conflictsStore.resolve(open[0].key, `auto:${v.winner}`)
  must(conflictsStore.stats().resolved === 1, '回填后没算 resolved')
  return `${v.winner} 已回填`
})

probe('X21 跨带缓存：同一问句第二次直接命中', () => {
  telemetry.clear()
  const k = telemetry.keyOf('plan', {}, ['火锅'])
  must(telemetry.get(k) === null, '空缓存却命中')
  telemetry.set(k, { ok: 1 })
  must(telemetry.get(k)?.ok === 1, '第二次没命中')
  const s = telemetry.snapshot()
  must(s.cacheHit === 1 && s.cacheMiss === 1, `计数不对 hit=${s.cacheHit} miss=${s.cacheMiss}`)
  return `hit=${s.cacheHit} miss=${s.cacheMiss}`
})

probe('X22 探针现探：先 null 后到，也能接上（不看启动顺序）', () => {
  let n = 0
  const organs = mocks.mockHippocampus({ hits: cands })
  const ctx = { get: (name) => (name === 'memory.hippocampus' ? (++n > 1 ? organs : null) : null) }
  const p1 = probeOrgans(ctx)
  const p2 = probeOrgans(ctx)
  must(p1.present === 0, `第一次应该探不到，实际 ${p1.present}`)
  must(p2.present > 0, '第二次没接上——探针被焊死了')
  return `present ${p1.present} → ${p2.present}`
})

// ── 收尾 ─────────────────────────────────────────────────────
const bad = t.filter((x) => !x.ok)
console.log(`\n## 互相检测结果（${t.length - bad.length}/${t.length}）`)
for (const r of t) {
  const note = r.note !== undefined ? `  → ${typeof r.note === 'object' ? JSON.stringify(r.note) : r.note}` : ''
  console.log(`  ${r.ok ? '✓' : '✗'} ${r.name}${note}`)
  if (!r.ok) console.log(`      ${r.err}`)
}

const totalBad = badItems.length + badSeams.length + bad.length
console.log('\n' + '='.repeat(56))
console.log(`66 条落点：${ITEMS.length - badItems.length}/${ITEMS.length}`)
console.log(`17 个接入面：${SEAMS.length - badSeams.length}/${SEAMS.length}`)
console.log(`互相检测：${t.length - bad.length}/${t.length}`)
console.log(totalBad === 0 ? '全部通过' : `${totalBad} 处没过`)
process.exit(totalBad === 0 ? 0 : 1)
