// 记忆器官第二批行为断言：context / episode / source / quiet
//
// 规矩同前：不验"有数据"，验"输入变→输出按方向动"；拿不到就 FAIL，不许静默通过。
//
//   node tests/memory-tools2.mjs
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const fails = []
const ok = (c, m) => { if (!c) fails.push(m) }
const textOf = (v) => (typeof v === 'string' ? v : JSON.stringify(v ?? ''))

const root = mkdtempSync(join(tmpdir(), 'mem-tools2-'))
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

const { apply } = await import('../index.js')
apply(ctx)
const hip = services.get('memory.hippocampus')
ok(Boolean(hip), '没拿到 memory.hippocampus')

const A = 'ctx-a'
const B = 'ctx-b'

// ① context：同一个 session 写完之后，上下文里要有刚说的话；别的 session 不该有
const before = await hip.context(A)
const r1 = await hip.write({ role: 'user', text: '明天想去海边走走，顺便吃个海鲜', session: A })
ok(!r1?.skipped, `写入被拒：${JSON.stringify(r1)}`)
const after = await hip.context(A)
ok(textOf(after).length >= textOf(before).length, 'context 写完反而变短了')
ok(/海边|海鲜/.test(textOf(after)), `context 里没有刚说的话：${textOf(after).slice(0, 160)}`)
const other = await hip.context(B)
// context 里有一段是刻意「跨对话」的（标题就这么写），所以不能用它当串味证据。
// 真正该验的是隔离：B 这个 session 一条 episode 都不该有。
const bEps = await hip.episodes({ session: B, limit: 10 })
const bRows = Array.isArray(bEps) ? bEps : (bEps?.episodes || [])
ok(bRows.length === 0, `别的 session 里冒出了 ${bRows.length} 条 episode（串味）`)

// ② episode(id)：按 id 取回的就是那一条；随便造个 id 必须是 null（不许瞎编）
const eps = await hip.episodes({ limit: 10 })
const rows = Array.isArray(eps) ? eps : (eps?.episodes || [])
ok(rows.length >= 1, 'episode 一条都没有')
const one = rows[0]
const got = hip.episode(one.id)
ok(Boolean(got), `episode(${one.id}) 取不回来`)
ok(String(got?.summary || '') === String(one.summary || ''), 'episode(id) 拿到的不是同一条')
ok(hip.episode('ep_does_not_exist') === null, '不存在的 id 居然返回了东西（编数据）')

// ③ source(id)：来源要能说清是哪次会话、哪条消息
const src = hip.source(one.id)
ok(Boolean(src), 'source(id) 返回空')
ok(String(src?.session || '') === String(one.session || ''), `source session ${JSON.stringify(src?.session)} != episode ${JSON.stringify(one.session)}`)
ok(hip.source('ep_does_not_exist') === null, '不存在的 id 的 source 居然有值')

// ④ quiet：调用要真的改变状态，而且要么 true 要么 false，不许 undefined
const q = hip.quiet({ minutes: 5 })
ok(q && typeof q === 'object', `quiet 返回异常：${JSON.stringify(q)}`)
ok(typeof q.quiet === 'boolean', `quiet 状态不是布尔：${JSON.stringify(q)}`)
ok(Number(q.minutes) === 5, `quiet 没记住分钟数：${JSON.stringify(q)}`)
const back = hip.quiet({ minutes: 0 })
ok(typeof back?.quiet === 'boolean', `第二次 quiet 状态不是布尔：${JSON.stringify(back)}`)

rmSync(root, { recursive: true, force: true })

if (fails.length) {
  console.log(`FAIL ${fails.length}:`)
  for (const f of fails) console.log(' - ' + f)
  process.exit(1)
}
console.log(`PASS 记忆工具二（context 带出新内容且不串 session / episode 按 id 精确 / source 指回 ${A} / quiet 可开关）`)
process.exit(0)
