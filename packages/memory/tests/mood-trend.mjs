// moodTrend：没有效价就说"看不出来"，有效价才算得对。
//
// 这里钉的是一个以前修过的坑：Number(null)===0，于是"没测到情绪"被当成
// 效价 0 算进去——withValence 虚高、平均值被稀释成 0，看着有数据其实没测到。
//
//   node tests/mood-trend.mjs
// 跑完两个方向：
//   1. 没效价 → withValence 0、coverage 0、confidence thin、trend 空
//   2. 有效价 → 计入、均值正确、按天聚合
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const root = mkdtempSync(join(tmpdir(), 'moodtrend-'))
process.env.DSH_HOME = root
process.env.HIPPOCAMPUS_DIR = join(root, 'hippocampus')
process.env.CORTEX_DIR = join(root, 'cortex')

const fails = []
const ok = (c, m) => { if (!c) fails.push(m) }

const services = new Map()
const ctx = {
  systemPrompt: { context: () => () => {} },
  webServer: { register: () => () => {} },
  tools: { register: () => () => {}, get: () => null },
  agents: { list: () => [] },
  provide: (n, v) => services.set(n, v),
  set: (n, v) => services.set(n, v),
  get: (n) => services.get(n) || null,
  on: () => () => {},
  emit: () => true,
  effect: () => () => {},
  logger: { info() {}, warn() {}, error() {} },
}

const { apply } = await import('../index.js')
apply(ctx)
const hip = services.get('memory.hippocampus')
const cx = services.get('memory.cortex')
await (cx?.whenReady?.() ?? Promise.resolve())

// ── 1. 没效价：必须如实"看不出来" ───────────────────────
await hip.write({ role: 'user', text: '今天开了个会', session: 's1', force: true })
await hip.write({ role: 'user', text: '下午改了下表格', session: 's1', force: true })
await hip.settle({ force: true })

const t1 = await hip.moodTrend()
ok(Number(t1.episodes) === 2, `episodes 该 2，实际 ${t1.episodes}`)
ok(Number(t1.withValence) === 0, `没效价却被算进去了：withValence=${t1.withValence}（旧 bug 会把它当 0）`)
ok(Number(t1.coverage) === 0, `coverage 该 0，实际 ${t1.coverage}`)
ok(t1.confidence === 'thin', `样本为 0 时 confidence 该是 thin，实际 ${t1.confidence}`)
ok(Array.isArray(t1.trend) && t1.trend.length === 0, `没效价不该有 trend：${JSON.stringify(t1.trend)}`)
ok(Number(t1.avgValence) === 0, `没效价时均值该 0（不参与计算），实际 ${t1.avgValence}`)

// ── 2. 有效价：要真的统计 ───────────────────────────────
await hip.write({ role: 'user', text: '好难过', session: 's1', force: true, valence: -0.8 })
await hip.write({ role: 'user', text: '后来挺开心', session: 's1', force: true, valence: 0.7 })
await hip.settle({ force: true })

const t2 = await hip.moodTrend()
ok(Number(t2.withValence) === 2, `两条有效价该都计入，实际 ${t2.withValence}`)
ok(Math.abs(Number(t2.coverage) - 2 / Number(t2.episodes)) < 0.001,
  `coverage 该是 2/${t2.episodes}，实际 ${t2.coverage}`)
ok(Math.abs(Number(t2.avgValence) + 0.05) < 0.01,
  `均值该是 (-0.8+0.7)/2 = -0.05，实际 ${t2.avgValence}`)
ok(Array.isArray(t2.trend) && t2.trend.length === 1, `同一天该聚合成一格，实际 ${JSON.stringify(t2.trend)}`)
if (t2.trend?.length) {
  ok(Number(t2.trend[0].n) === 2, `当天条数该 2，实际 ${t2.trend[0].n}`)
  ok(Math.abs(Number(t2.trend[0].avg) + 0.05) < 0.01, `当天均值不对：${t2.trend[0].avg}`)
}

// 窗口外不算
const t3 = await hip.moodTrend({ days: 1 })
ok(Number(t3.days) === 1, `days 没生效：${t3.days}`)
ok(Number(t3.withValence) <= Number(t2.withValence), `1 天窗口不该比 30 天多：${t3.withValence} > ${t2.withValence}`)

rmSync(root, { recursive: true, force: true })

if (fails.length) {
  console.log(`FAIL ${fails.length}:`)
  for (const f of fails) console.log(' - ' + f)
  process.exit(1)
}
console.log(`PASS 情绪趋势（没效价 → thin/0 条；有效价 → 2 条、均值 ${t2.avgValence}、当天聚合 n=${t2.trend[0].n}）`)
process.exit(0)
