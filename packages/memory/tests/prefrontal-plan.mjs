// 前额叶的检索计划（prefrontal.plan）：同一句话，计划应该不一样。
//
// 这块以前没断言，但它错的方向很致命——寒暄也去检索（浪费＋乱想起）、
// "上次"和"今天"用同一个时间窗（答非所问）。
//
//   node tests/prefrontal-plan.mjs
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const root = mkdtempSync(join(tmpdir(), 'plan-'))
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
const pfc = services.get('memory.prefrontal')

async function plan(q) {
  const p = await pfc.plan(q)
  ok(p && typeof p === 'object', `${q} → plan 没返回对象`)
  ok(Array.isArray(p?.why) && p.why.length > 0, `${q} → 计划没给理由：${JSON.stringify(p?.why)}`)
  return p
}

// ── 寒暄：不该检索 ─────────────────────────────────────
const hello = await plan('你好')
ok(hello.mode === 'skip', `寒暄该 skip，实际 ${hello.mode}`)
ok(hello.intent === 'chat', `寒暄该判 chat，实际 ${hello.intent}`)

// ── "上次"：给上界，不给下界 ───────────────────────────
const before = await plan('我上次说去面试是哪天')
ok(before.intent === 'time', `问哪天该判 time，实际 ${before.intent}`)
ok(Number.isFinite(Number(before.filters?.until)), `"上次"该给 until：${JSON.stringify(before.filters)}`)
ok(before.filters?.since == null, `"上次"不该给 since：${JSON.stringify(before.filters)}`)

// ── "今天"：给下界（今天零点），不给上界 ───────────────
const today = await plan('今天几号')
ok(today.intent === 'time', `问今天该判 time，实际 ${today.intent}`)
ok(Number.isFinite(Number(today.filters?.since)), `"今天"该给 since：${JSON.stringify(today.filters)}`)
ok(today.filters?.until == null, `"今天"不该给 until：${JSON.stringify(today.filters)}`)
const since = new Date(Number(today.filters.since))
const now = new Date()
ok(since.getFullYear() === now.getFullYear() && since.getMonth() === now.getMonth() && since.getDate() === now.getDate(),
  `界不是今天零点：${since.toISOString()}`)
ok(Number(today.filters.since) < Date.now(), `下界该在过去：${today.filters.since}`)

// ── 情绪自述：走 episode，不是 preference ──────────────
const sad = await plan('我很难过')
ok(sad.intent === 'episode', `说难过该判 episode，实际 ${sad.intent}`)
ok(sad.mode !== 'skip', '说难过不该被跳过')

// ── 偏好自述：走 preference ────────────────────────────
const like = await plan('我喜欢吃辣')
ok(like.intent === 'preference', `说喜欢该判 preference，实际 ${like.intent}`)
ok(like.mode !== 'skip', '说喜欢不该被跳过')

rmSync(root, { recursive: true, force: true })

if (fails.length) {
  console.log(`FAIL ${fails.length}:`)
  for (const f of fails) console.log(' - ' + f)
  process.exit(1)
}
console.log(`PASS 检索计划（寒暄 ${hello.intent}/${hello.mode}；上次 until=${before.filters.until} 无 since；今天 since=${new Date(Number(today.filters.since)).toISOString()} 无 until；难过 ${sad.intent}；喜欢 ${like.intent}）`)
process.exit(0)
