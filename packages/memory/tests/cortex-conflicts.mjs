// 冲突识别与裁决：同一件事说了两个不同的值，皮层要发现、要能裁。
//
//   node tests/cortex-conflicts.mjs
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const fails = []
const ok = (c, m) => { if (!c) fails.push(m) }

const root = mkdtempSync(join(tmpdir(), 'conflict-'))
process.env.DSH_HOME = root
process.env.HIPPOCAMPUS_DIR = join(root, 'hippocampus')
process.env.CORTEX_DIR = join(root, 'cortex')

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
const cortex = services.get('memory.cortex')

async function say(text) {
  await hip.write({ role: 'user', text, session: 'c1', force: true })
  await hip.settle({ force: true })
  await hip.consolidate({ mode: 'shallow' })
}

// 先说住威海，再说住青岛 —— 同一主语同一谓词，值不同
await say('我住在威海')
const st1 = await cortex.stats()
ok(Number(st1?.facts) >= 1, `第一条事实没进库：${JSON.stringify(st1)?.slice(0, 160)}`)

await say('我住在青岛')
const st2 = await cortex.stats()
ok(Number(st2?.facts) >= 2, `第二条事实没进库：facts ${st2?.facts}`)

const list = await cortex.conflicts()
ok(Array.isArray(list), `conflicts 没返回数组：${JSON.stringify(list)?.slice(0, 120)}`)
if (list.length === 0) {
  console.log('FAIL：两条互斥的住所事实并存，conflicts() 为空')
  rmSync(root, { recursive: true, force: true })
  process.exit(2)
}
ok(list.length >= 1, `应有冲突`)

// 裁决：选 b（后说的那条），冲突要消掉、旧值不该再当事实
const res = await cortex.resolve(0, 'b')
ok(res && (res.ok === true || res.resolved === true || res.state === 'resolved'), `resolve 返回异常：${JSON.stringify(res)?.slice(0, 160)}`)

const after = await cortex.conflicts()
ok(after.length < list.length, `裁决之后冲突没减少：${list.length} → ${after.length}`)

rmSync(root, { recursive: true, force: true })

if (fails.length) {
  console.log(`FAIL ${fails.length}:`)
  for (const f of fails) console.log(' - ' + f)
  process.exit(1)
}
console.log(`PASS 冲突（同主语同谓词两个值 → 识别 ${list.length} 条 → 裁决后剩 ${after.length} 条）`)
process.exit(0)
