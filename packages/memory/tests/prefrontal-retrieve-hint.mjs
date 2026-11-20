// 前额叶的检索链：plan → hint → retrieve；以及 shadow（只记录）/ feedback（校准计数）。
//
// 约定先记清：
//   · hint(plan, suppressed) 收的是 **plan 对象**，不是查询字符串（传字符串会得到空 target）
//   · shadow 只记录，不许假装"已经应用"
//   · feedback 只改校准计数，不该回头改别人
//
//   node tests/prefrontal-retrieve-hint.mjs
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const root = mkdtempSync(join(tmpdir(), 'pfret-'))
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
await new Promise((r) => setTimeout(r, 400))

// ── hello：器官在不在，要和实际一致 ───────────────────
const hello = await pfc.hello()
ok(hello && typeof hello === 'object', `hello 没返回对象：${JSON.stringify(hello)}`)
ok(Number.isFinite(Number(hello.version)), `hello 没带版本：${JSON.stringify(hello)}`)
ok(hello.organs?.hippocampus === true && hello.organs?.cortex === true && hello.organs?.amygdala === true,
  `三个器官都在，hello 却说没接全：${JSON.stringify(hello.organs)}`)

// ── hint：拿 plan 才有内容 ─────────────────────────────
const plan = await pfc.plan('我住在哪')
const h = pfc.hint(plan)
ok(h && typeof h === 'object', `hint 没返回对象：${JSON.stringify(h)}`)
ok(String(h.target || '').length > 0, `hint 的 target 是空的（plan 里明明有）：${JSON.stringify(h)}`)
ok(Array.isArray(h.boost) && h.boost.length >= 1, `hint 没给 boost：${JSON.stringify(h)}`)
ok(h.boost.includes('我住') || h.boost.includes('住在'),
  `boost 里没有能用的词：${JSON.stringify(h.boost)}`)

// 被压制的要进 exclude
const h2 = pfc.hint(plan, [{ id: 'c_1' }, { id: 'c_2' }])
ok(Array.isArray(h2.exclude) && h2.exclude.includes('c_1') && h2.exclude.includes('c_2'),
  `exclude 没带上被压制的：${JSON.stringify(h2.exclude)}`)

// ── retrieve：整条链要给计划 + 轮次 ────────────────────
const r = await pfc.retrieve('我住在哪')
ok(r && r.ok === true, `retrieve 没成功：${JSON.stringify(r).slice(0, 160)}`)
ok(r.plan?.intent === 'fact', `"我住在哪" 该判 fact，实际 ${r.plan?.intent}`)
ok(Array.isArray(r.rounds) && r.rounds.length >= 1, `retrieve 没有轮次：${JSON.stringify(r.rounds)}`)
ok(r.rounds.every((x) => typeof x.strategy === 'string' && x.strategy.length > 0),
  `有轮次没写策略：${JSON.stringify(r.rounds)}`)

// 空输入：不许炸
let emptyThrew = null
let empty = null
try { empty = await pfc.retrieve('') } catch (e) { emptyThrew = e }
ok(!emptyThrew, `retrieve('') 不该抛：${emptyThrew?.message}`)
ok(empty && typeof empty.ok === 'boolean', `retrieve('') 没给 ok：${JSON.stringify(empty)}`)

// ── shadow：只记录，不许假装应用 ──────────────────────
const sh = await pfc.shadow('我住在哪')
ok(sh && sh.apply === false, `shadow 不该说"已应用"：${JSON.stringify(sh)}`)
ok(String(sh.note || '').length > 0, `shadow 该说明自己只是记录：${JSON.stringify(sh)}`)

// ── feedback：只动计数，且方向对 ──────────────────────
const f1 = pfc.feedback('preference', false)
ok(Number(f1?.preference?.deny) === 1, `说"不对"之后 deny 该是 1：${JSON.stringify(f1)}`)
ok(Number(f1?.preference?.n) === 1, `n 该是 1：${JSON.stringify(f1)}`)
const f2 = pfc.feedback('preference', true)
ok(Number(f2?.preference?.hit) === 1, `说"对"之后 hit 该是 1：${JSON.stringify(f2)}`)
ok(Number(f2?.preference?.deny) === 1, `deny 不该被抹掉：${JSON.stringify(f2)}`)
ok(Number(f2?.preference?.n) === 2, `n 该累加到 2：${JSON.stringify(f2)}`)

rmSync(root, { recursive: true, force: true })

if (fails.length) {
  console.log(`FAIL ${fails.length}:`)
  for (const f of fails) console.log(' - ' + f)
  process.exit(1)
}
console.log(`PASS 检索链（hello ${hello.version} 三器官齐；hint target「${h.target}」boost ${h.boost.length} 个；retrieve ${r.rounds.length} 轮 intent=${r.plan.intent}；shadow 只记录；feedback ${JSON.stringify(f2.preference)}）`)
process.exit(0)
