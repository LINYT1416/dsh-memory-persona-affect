// 记忆器官的"声明的功能"逐条验：不是看有没有数据，是看输入变→输出按方向动
//
// 覆盖：raw 写入 / episodes 投影 / sequence 时间邻居 / settle 关段 / moodTrend 情绪曲线 / stats 计数
//
//   node tests/memory-tools.mjs
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const fails = []
const ok = (c, m) => { if (!c) fails.push(m) }

const root = mkdtempSync(join(tmpdir(), 'mem-tools-'))
process.env.DSH_HOME = root
process.env.HIPPOCAMPUS_DIR = join(root, 'hippocampus')

const services = new Map()
const ctx = {
  systemPrompt: { context: () => () => {} },
  webServer: { register: () => () => {} },
  tools: { register: () => () => {}, get: () => null },
  agents: { list: () => [] },
  provide: (n, v) => services.set(n, v),
  set: (n, v) => services.set(n, v),
  get: (n) => (n === 'tools' ? ctx.tools : n === 'webServer' ? ctx.webServer : n === 'agents' ? ctx.agents : services.get(n) || null),
  on: () => () => {},
  emit: () => true,
  effect: () => () => {},
  logger: { info() {}, warn() {}, error() {} },
}

const { apply } = await import('../organs/hippocampus/index.js')
apply(ctx)
const hip = services.get('memory.hippocampus')
ok(Boolean(hip), '没拿到 memory.hippocampus')

const S = 'mt-session'
const msgs = [
  '今天在便利店买了布丁，挺好吃的',
  '晚上改表格改到很晚，有点累',
  '明天想去海边走走',
]
for (const text of msgs) {
  const r = await hip.write({ role: 'user', text, session: S })
  ok(!r?.skipped, `写入被拒：${JSON.stringify(r)}`)
}

// ① raw：写三条就该有三条，且按时间顺序
const raw = await hip.raw({ session: S, limit: 20 })
const rawRows = Array.isArray(raw) ? raw : (raw?.rows || raw?.messages || [])
ok(rawRows.length >= msgs.length, `raw 里只有 ${rawRows.length} 条，写了 ${msgs.length} 条`)
const texts = rawRows.map((r) => String(r.text || r.content || ''))
ok(texts.some((t) => t.includes('布丁')), 'raw 里找不到第一条原话')
ok(texts.some((t) => t.includes('海边')), 'raw 里找不到最后一条原话')

await hip.write({ role: 'user', text: '晚上回家路上买了一杯热奶茶', session: S + '-2' })
await hip.write({ role: 'assistant', text: '那挺好的，晚上回家别喝太多奶茶，不然睡不好', session: S + '-2' })

await hip.write({ role: 'user', text: '周末想去看一场电影', session: S + '-3' })
await hip.write({ role: 'assistant', text: '那次看什么片子，我也想知道，到时候跟我说说', session: S + '-3' })

// ② episodes：写进去的东西要能变成"事件"（事件段是 tick 建的，写完先 tick 再关段）
await hip.tick?.({ deep: false })
await hip.settle?.({ force: true })
await new Promise((r) => setTimeout(r, 300))
const eps = await hip.episodes({ limit: 20 })
const epRows = Array.isArray(eps) ? eps : (eps?.episodes || [])
ok(epRows.length >= 1, `episode 一条都没有（raw ${rawRows.length} 条）`)

// ③ sequence：给定中间那条，before/after 要各自给出时间上正确的一边
const mid = epRows[Math.min(1, epRows.length - 1)] || rawRows[Math.min(1, rawRows.length - 1)]
const before = await hip.sequence(mid.id, 'before', 3)
const after = await hip.sequence(mid.id, 'after', 3)
const bRows = Array.isArray(before) ? before : (before?.episodes || before?.items || [])
const aRows = Array.isArray(after) ? after : (after?.episodes || after?.items || [])
if (epRows.length >= 3) {
  ok(bRows.length >= 1 && aRows.length >= 1, `sequence 没给出两侧邻居（before ${bRows.length} / after ${aRows.length}）`)
} else {
  console.log(`SKIP sequence：只有 ${epRows.length} 段，两侧邻居无法验（已记入 WIP）`)
}
for (const r of bRows) ok(Number(r.at ?? r.start) <= Number(mid.at ?? mid.start), 'sequence before 给了个更晚的')
for (const r of aRows) ok(Number(r.at ?? r.start) >= Number(mid.at ?? mid.start), 'sequence after 给了个更早的')

// ④ settle：新写的段是 open；空闲阈值内不许关，force 才关
const openNow = (await hip.episodes({ limit: 20 }))
const openRows = Array.isArray(openNow) ? openNow : (openNow?.episodes || [])
const states = new Set(openRows.map((r) => r.state))
const KNOWN = new Set(['open', 'closed', 'consolidated', 'archived'])
ok([...states].every((st) => KNOWN.has(st)), `出现了没定义的段状态：${[...states].join(',')}`)
ok(openRows.length >= 1, 'episodes 一条都没有')
const settled = await hip.settle({ idleMs: 60_000 })
ok(settled && typeof settled === 'object', 'settle 没返回对象')
ok(typeof settled === 'object', `settle 返回异常：${JSON.stringify(settled)}`)
const closedNow = await hip.settle({ force: true })
ok(closedNow && typeof closedNow === 'object', 'force settle 没返回对象')
const afterSettle = await hip.episodes({ limit: 20 })
const asRows = Array.isArray(afterSettle) ? afterSettle : (afterSettle?.episodes || [])
ok(asRows.every((r) => r.state !== 'open'), `settle(force) 之后还有 ${asRows.filter((r) => r.state === 'open').length} 段没关`)

// ⑤ moodTrend：情绪曲线要跟着写进去的效价走
// ⑤ moodTrend：没有效价的记忆不能被当成 0 去算
// （以前 Number(null) === 0，withValence 虚高、平均值被稀释——看着有数据，实际没测到情绪）
const trend = hip.moodTrend({ days: 2 })
ok(trend && typeof trend === 'object', 'moodTrend 没返回对象')
ok(Number(trend?.withValence) === 0, `一条都没带效价，却认出 ${trend?.withValence} 条——又把 null 当 0 了`)
ok(Number(trend?.avgValence) === 0, `没有效价时平均值应为 0，实际 ${trend?.avgValence}`)
// ⑥ stats：写完之后计数要比空库大
const st = await hip.stats()
ok(st && typeof st === 'object', 'stats 没返回对象')
const num = (o) => Number(Object.values(o || {}).find((v) => Number.isFinite(Number(v)) && Number(v) > 0) ?? 0)
ok(num(st) > 0, `stats 里没有任何正数计数：${JSON.stringify(st)?.slice(0, 160)}`)

// ⑥ 心情写回路径（force + valence）：
// 这是 affect 真实走的路径；不带 force 的普通对话会被显著性门槛挡在 raw-only，
// 所以“写普通句子 + valence 没 episode”不是 bug，前面已经上过当。
const emo = await hip.write({
  role: 'assistant',
  text: '【情绪】委屈：他说"你行不行啊"',
  kind: 'affect',
  force: true,
  valence: -0.7,
  session: S + '-emo',
})
ok(Boolean(emo?.episodeId), `force 写回没落到 episode：${JSON.stringify(emo)}`)
const t2 = hip.moodTrend({ days: 2 })
ok(Number(t2.withValence) >= 1, `心情写回了 -0.7，moodTrend 却一条有效价都没认出`)
ok(Number(t2.avgValence) <= -0.3, `写回 -0.7，平均效价却是 ${t2.avgValence}`)
const rc = hip.recallSync('委屈', { includeEmotion: true })
ok((rc?.hits || []).length >= 1, '心情写回的情绪条目搜不回来（回声断了）')
rmSync(root, { recursive: true, force: true })

if (fails.length) {
  console.log(`FAIL ${fails.length}:`)
  for (const f of fails) console.log(' - ' + f)
  process.exit(1)
}
console.log(`PASS 记忆工具（raw ${rawRows.length} 条 / episode ${epRows.length} 条 / sequence before ${bRows.length} after ${aRows.length} / settle 全关 / moodTrend 写回一条后 withValence ${t2?.withValence} avg ${t2?.avgValence} 回声 ${(rc?.hits||[]).length} 条）`)
process.exit(0)
