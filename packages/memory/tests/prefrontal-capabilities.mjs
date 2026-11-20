// 前额叶的自我描述：capabilities / invariants.noContent / seams。
//
// 这三个最容易被写成"永远返回好看的值"——什么都是 true、missing 永远空。
// 这里钉的是"它敢承认自己没有的东西"：
//   · 这个临时环境里没有向量，vector 就必须是 false（不是 true）
//   · seams 缺了要列出来（present + missing 加起来等于 total）
//   · noContent 自检要真的能跑出 ok / bad
//
//   node tests/prefrontal-capabilities.mjs
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const root = mkdtempSync(join(tmpdir(), 'pfcap-'))
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
await new Promise((r) => setTimeout(r, 500))

// ── capabilities：字段是布尔，且敢说自己没有向量 ────────
const caps = await pfc.capabilities()
ok(caps && typeof caps === 'object', `capabilities 没返回对象：${JSON.stringify(caps)}`)
for (const k of ['vector', 'graph', 'semantic']) {
  ok(typeof caps[k] === 'boolean', `${k} 不是布尔：${JSON.stringify(caps)}`)
}
ok(caps.vector === false, `这个环境没有向量，vector 不该是 true（实际 ${caps.vector}）`)
ok(caps.graph === true && caps.semantic === true,
  `皮层和海马都在，graph/semantic 该是 true：${JSON.stringify(caps)}`)

// ── invariants.noContent：能跑、能报出问题 ─────────────
ok(typeof pfc.invariants?.noContent === 'function', 'invariants.noContent 不是函数')
const inv = pfc.invariants.noContent()
ok(inv && typeof inv === 'object', `noContent 没返回对象：${JSON.stringify(inv)}`)
ok(typeof inv.ok === 'boolean', `noContent 没给 ok：${JSON.stringify(inv)}`)
ok(Array.isArray(inv.bad), `noContent 的 bad 不是数组：${JSON.stringify(inv)}`)
ok(Number.isFinite(Number(inv.inputs)), `noContent 没记检查了几条输入：${JSON.stringify(inv)}`)

// ── seams：13 个口都在，缺的必须列出来而不是吞掉 ───────
const seams = pfc.seams()
ok(seams && typeof seams === 'object', `seams 没返回对象：${JSON.stringify(seams)}`)
ok(Number(seams.total) > 0, `seams.total 不合理：${JSON.stringify(seams)}`)
ok(Array.isArray(seams.missing), `seams.missing 不是数组：${JSON.stringify(seams)}`)
ok(Number(seams.present) + seams.missing.length === Number(seams.total),
  `present(${seams.present}) + missing(${seams.missing.length}) ≠ total(${seams.total})`)

rmSync(root, { recursive: true, force: true })

if (fails.length) {
  console.log(`FAIL ${fails.length}:`)
  for (const f of fails) console.log(' - ' + f)
  process.exit(1)
}
console.log(`PASS 前额叶自述（vector=${caps.vector} graph=${caps.graph} semantic=${caps.semantic}；noContent ok=${inv.ok} 检查 ${inv.inputs} 条；接缝 ${seams.present}/${seams.total} 缺 ${seams.missing.length}）`)
process.exit(0)
