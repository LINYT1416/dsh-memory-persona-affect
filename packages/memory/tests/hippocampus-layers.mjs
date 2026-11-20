// 海马体的分层开关（L5-6）：关掉哪一层，那层就降级；打开就恢复。
//
// 注意：service.layers 是个**方法对象**（list/off/on/isOff），
// JSON.stringify 出来永远是 {}——别把这当成"字段没人填"。
//
//   node tests/hippocampus-layers.mjs
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const root = mkdtempSync(join(tmpdir(), 'layers-'))
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
const hip = services.get('memory.hippocampus')

// ── 静态信息：版本是字符串、向量是布尔 ─────────────────
ok(typeof hip.version === 'string' && hip.version.length > 0, `version 不是字符串：${hip.version}`)
ok(typeof hip.vectorReady === 'boolean', `vectorReady 不是布尔：${hip.vectorReady}`)

// ── 五层齐全、默认全开 ─────────────────────────────────
const list = hip.layers.list()
ok(Array.isArray(list) && list.length === 5, `层数不对：${JSON.stringify(list)}`)
const names = list.map((l) => l.name)
for (const n of ['encode', 'index', 'recall', 'consolidate', 'forget']) {
  ok(names.includes(n), `少了层 ${n}：${names.join(',')}`)
}
ok(list.every((l) => l.on === true), `默认该全开：${JSON.stringify(list)}`)

// ── 关掉 encode：写入必须被拦下，而且要说清原因 ────────
hip.layers.off('encode')
ok(hip.layers.isOff('encode') === true, 'off 之后 isOff 该是 true')

const blocked = await hip.write({ role: 'user', text: '我在威海上班，做结构设计', session: 's1', force: true })
ok(blocked?.skipped === 'layer-off', `关掉 encode 后该被拦，实际 ${JSON.stringify(blocked)}`)
ok(Number((await hip.stats()).episodes) === 0, '被拦的写入不该产生 episode')

// ── 打开 encode：写入恢复 ──────────────────────────────
hip.layers.on('encode')
ok(hip.layers.isOff('encode') === false, 'on 之后 isOff 该是 false')

await hip.write({ role: 'user', text: '我在威海上班，做结构设计', session: 's1', force: true })
const after = await hip.stats()
ok(Number(after.episodes) === 1, `打开后该写进 1 条，实际 ${after.episodes}`)

// ── tick：清扫 + 巩固，字段类型要对 ────────────────────
const t = await hip.tick()
ok(t && typeof t === 'object', `tick 没返回对象：${JSON.stringify(t)}`)
ok(Number.isFinite(Number(t.swept?.swept)), `tick.swept.swept 不是数字：${JSON.stringify(t.swept)}`)
ok('consolidate' in t, `tick 没报巩固结果：${JSON.stringify(t)}`)

// ── settle：强制关段，不许炸 ──────────────────────────
const st = await hip.settle({ force: true })
ok(st && Number.isFinite(Number(st.closed)), `settle 没回 closed：${JSON.stringify(st)}`)

rmSync(root, { recursive: true, force: true })

if (fails.length) {
  console.log(`FAIL ${fails.length}:`)
  for (const f of fails) console.log(' - ' + f)
  process.exit(1)
}
console.log(`PASS 分层开关（5 层默认全开；关 encode→write 被拦 skipped=${blocked.skipped}；打开后写入 ${after.episodes} 条；tick 清扫 ${t.swept.swept}；settle closed=${st.closed}）`)
process.exit(0)
