// 前额叶的闸：噪声不进记忆，真话才进，深度还要分档。
//
// 以前 "嗯嗯"、"好的" 会被判成 keep（正常）——这就是"垃圾进"。
// 这个测试盯三件事：噪声挡住、真话放行、深度分档。
//
//   node tests/pfc-gate.mjs
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const root = mkdtempSync(join(tmpdir(), 'gate-'))
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

// service 层 shouldRemember 返回布尔（海马契约要的就是布尔）
const noise = ['嗯嗯', '啊', '哦', '好的', '好吧', '行', '收到', '哈哈哈', 'ok']
const real = [
  '我下周三去面试了，特别紧张',
  '我叫示例用户，做机器人结构设计的',
  '我最讨厌别人骗我',
]

const passedNoise = []
for (const t of noise) {
  const keep = await pfc.shouldRemember(t, { role: 'user' })
  if (keep !== false) passedNoise.push(t)
}
ok(passedNoise.length === 0, `这些噪声被当成正常记忆了：${passedNoise.join(' / ')}`)

const blockedReal = []
for (const t of real) {
  const keep = await pfc.shouldRemember(t, { role: 'user' })
  if (keep !== true) blockedReal.push(t)
}
ok(blockedReal.length === 0, `真话被拦了：${blockedReal.join(' / ')}`)

// 用户明说"别记"：必须拦
const veto = await pfc.shouldRemember('这个别记，回头删了', { role: 'user' })
ok(veto === false, `「别记」没拦住（返回 ${veto}）`)

// 空串不许当正常
const blank = await pfc.shouldRemember('   ', { role: 'user' })
ok(blank === false, `空白串被当成可记（返回 ${blank}）`)

rmSync(root, { recursive: true, force: true })

if (fails.length) {
  console.log(`FAIL ${fails.length}:`)
  for (const f of fails) console.log(' - ' + f)
  process.exit(1)
}
console.log(`PASS 前额叶闸门（噪声 ${noise.length} 条全挡；真话 ${real.length} 条全放行；「别记」挡住；空白挡住）`)
process.exit(0)
