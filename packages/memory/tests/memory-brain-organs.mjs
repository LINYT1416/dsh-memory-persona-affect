// 大脑总览口（memory.brain）：四个器官都接上了没有、失败的有没有、注入开关在哪。
//
// 这个口如果报错了，别的插件拿到的是"看起来正常但其实少了一个器官"的世界，
// 所以断言它必须跟实际注册的服务对得上，而不是照抄一份列表。
//
//   node tests/memory-brain-organs.mjs
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const root = mkdtempSync(join(tmpdir(), 'brain-'))
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
const brain = services.get('memory.brain')
ok(Boolean(brain), '没拿到 memory.brain')

const organs = brain.organs
ok(Array.isArray(organs), `organs 不是数组：${JSON.stringify(organs)}`)
ok(organs.length >= 4, `器官太少了：${JSON.stringify(organs)}`)

// ── 报出来的器官，必须真的注册了服务 ───────────────────
const missing = organs.filter((name) => !services.get(`memory.${name}`))
ok(missing.length === 0, `报了的器官没有对应服务：${missing.join(',')}`)

// ── 反过来：注册了的器官服务，都得在清单里（别漏报）────
const registered = [...services.keys()]
  .filter((k) => k.startsWith('memory.') && k !== 'memory.brain')
  .map((k) => k.slice('memory.'.length))
const unreported = registered.filter((n) => !organs.includes(n))
ok(unreported.length === 0, `注册了但没报：${unreported.join(',')}`)

// ── 失败清单：这一刻应该是空的 ─────────────────────────
ok(Array.isArray(brain.failed), `failed 不是数组：${JSON.stringify(brain.failed)}`)
ok(brain.failed.length === 0, `有器官装载失败：${JSON.stringify(brain.failed)}`)

// ── status() 必须跟顶层字段一致，且带时间 ──────────────
const st = brain.status()
ok(typeof st?.version === 'string' && st.version.length > 0, `version 空：${st?.version}`)
ok(JSON.stringify(st.organs) === JSON.stringify(organs), `status.organs 跟顶层不一致：${JSON.stringify(st.organs)}`)
ok(JSON.stringify(st.failed) === JSON.stringify(brain.failed), 'status.failed 跟顶层不一致')
ok(Number.isFinite(Number(st.at)), `status.at 不是时间戳：${st?.at}`)
ok(Math.abs(Date.now() - Number(st.at)) < 60_000, `status.at 是旧的：${st?.at}`)

// ── 注入开关：每个器官都要有一个明确的布尔值 ───────────
for (const name of organs) {
  ok(typeof st.inject?.[name] === 'boolean', `注入开关缺失或不是布尔：${name}=${st.inject?.[name]}`)
}

rmSync(root, { recursive: true, force: true })

if (fails.length) {
  console.log(`FAIL ${fails.length}:`)
  for (const f of fails) console.log(' - ' + f)
  process.exit(1)
}
const inj = Object.entries(st.inject).map(([k, v]) => `${k}:${v ? 'on' : 'off'}`).join(' ')
console.log(`PASS 大脑总览（器官 ${organs.join('/')}；服务与清单一致；失败 0；注入 ${inj}）`)
process.exit(0)
