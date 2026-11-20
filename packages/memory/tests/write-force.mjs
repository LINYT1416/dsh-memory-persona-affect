// 结构化写入必须能进：force 标志曾经被无视
//
// 事故：心情每拍写回 `{kind:'affect', text:'【情绪】…', force:true}`，
// 而 isStorable 只认 role=user/assistant —— 于是每一条都被判 noise 丢掉，
// 心情那边却记着"写回成功"。177 条账本对 34 条 episode 就是这么来的。
//
//   node tests/write-force.mjs
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const fails = []
const ok = (c, m) => { if (!c) fails.push(m) }

const root = mkdtempSync(join(tmpdir(), 'write-force-'))
process.env.DSH_HOME = root
process.env.HIPPOCAMPUS_DIR = join(root, 'hippocampus')

// 必须在插件被 import 之前设好目录，否则模块级常量已经按生产目录算完了
const { apply } = await import('dsh-all')

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

apply(ctx)
const hip = services.get('memory.hippocampus')
ok(Boolean(hip), '没拿到 memory.hippocampus')

// ── 1. force 的路：必须收下 ──────────────────────────────
const forced = await hip.write({
  kind: 'affect',
  text: '【情绪】委屈：他说"你行不行啊"',
  force: true,
  bypass: true,
  valence: -0.4,
  session: 'w-test',
})
ok(forced && !forced.skipped, `force 写入被拒：${JSON.stringify(forced)}`)
ok(Boolean(forced?.episodeId), `force 写入没产出 episode：${JSON.stringify(forced)}`)

// ── 2. 不 force、又不带 role：按"噪声"拒收（旧行为，保留）──
const plain = await hip.write({ kind: 'affect', text: '【情绪】委屈：随便一句', session: 'w-test' })
ok(plain?.skipped === 'noise', `不带 force/role 时该判 noise，实际 ${JSON.stringify(plain)}`)

// ── 3. 收下的那条真的在 episodes 里 ──────────────────────
const eps = await hip.episodes({ limit: 50 })
const rows = Array.isArray(eps) ? eps : (eps?.episodes || eps?.rows || [])
const mine = rows.filter((r) => /他说/.test(String(r?.summary || r?.brief || r?.text || '')))
ok(mine.length >= 1, `episodes 里找不到刚写的那条（共 ${rows.length} 条）`)

rmSync(root, { recursive: true, force: true })

if (fails.length) {
  console.log(`FAIL ${fails.length}:`)
  for (const f of fails) console.log(' - ' + f)
  process.exit(1)
}
console.log('PASS force 写入（结构化条目收下并进 episode；不带 force 仍按 noise 拦）')
process.exit(0)
