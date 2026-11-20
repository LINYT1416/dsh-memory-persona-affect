// "垃圾不进 recent"：情绪写回的条目不许出现在日常记忆注入里。
//
// 背景：recall 默认排除情绪条目，人格的 recent 也排除；
// 但 composeContext 以前不排，于是【情绪】… 被当成"最近发生的事"注入提示词。
//
//   node tests/context-clean.mjs
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const root = mkdtempSync(join(tmpdir(), 'ctxclean-'))
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
  get: (n) => (n === 'tools' ? ctx.tools : n === 'webServer' ? ctx.webServer : n === 'agents' ? ctx.agents : services.get(n) || null),
  on: () => () => {},
  emit: () => true,
  effect: () => () => {},
  logger: { info() {}, warn() {}, error() {} },
}

const { apply } = await import('../index.js')
apply(ctx)
const hip = services.get('memory.hippocampus')

// 同一会话里：一件真事 + 一条情绪写回
await hip.write({ role: 'user', text: '明天想去海边走走，顺便吃个海鲜', session: 's1' })
await hip.write({
  role: 'assistant',
  text: '【情绪】委屈：他说"你行不行啊"',
  kind: 'affect',
  force: true,
  valence: -0.6,
  session: 's1',
})

const text = String(await hip.context('s1'))
ok(text.includes('海边'), `正常记忆没进 context：${text.slice(0, 200)}`)
ok(!text.includes('【情绪】'), `情绪条目混进了"最近记得的事"：${text.slice(0, 240)}`)
ok(!/委屈：/.test(text), `情绪的正文漏进 context：${text.slice(0, 240)}`)

// 换一个窗口（本会话空）：跨对话回退里也不该出现情绪腔
const other = String(await hip.context('s2'))
ok(text.length > 0, '本会话 context 是空的')
ok(!other.includes('【情绪】'), `跨对话回退里带了情绪条目：${other.slice(0, 240)}`)

// 但情绪本身仍然能按 includeEmotion 被检索到（过滤只针对日常注入，不是删数据）
const rc = hip.recallSync('委屈', { includeEmotion: true })
ok((rc?.hits || []).length >= 1, '过滤之后连 includeEmotion 都搜不到情绪条目了（过头了）')

rmSync(root, { recursive: true, force: true })

if (fails.length) {
  console.log(`FAIL ${fails.length}:`)
  for (const f of fails) console.log(' - ' + f)
  process.exit(1)
}
console.log('PASS 日常注入干净（正常事在 / 情绪腔不在 / includeEmotion 仍可检索）')
process.exit(0)
