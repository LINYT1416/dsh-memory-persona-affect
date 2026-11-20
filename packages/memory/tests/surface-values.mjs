// 六个"值/对象"口：不是函数也要验，而且验的是**内容对不对**，不是"存在"。
//
// 覆盖统计说这 6 个从没在测试里按名字出现过：
//   cortex.v / cortex.features / amygdala.switches /
//   prefrontal.invariants / hippocampus.layers / hippocampus.vectorReady
// 它们各自有断言分散在别处，这里集中起来，且必须给出真实数值。
//
//   node tests/surface-values.mjs
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const root = mkdtempSync(join(tmpdir(), 'surface-'))
process.env.DSH_HOME = root
process.env.HIPPOCAMPUS_DIR = join(root, 'hippocampus')
process.env.CORTEX_DIR = join(root, 'cortex')
process.env.AMYGDALA_DIR = join(root, 'amygdala')
process.env.PREFRONTAL_DIR = join(root, 'prefrontal')

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

const cx = services.get('memory.cortex')
const amy = services.get('memory.amygdala')
const pfc = services.get('memory.prefrontal')
const hip = services.get('memory.hippocampus')
await (cx?.whenReady?.() ?? Promise.resolve())

// ── cortex.v：契约版本，得是个有版本样子的值 ─────────────
const v = cx.v
ok(v !== undefined && v !== null, `cortex.v 是空：${JSON.stringify(v)}`)
ok(typeof v === 'number' || /^\d+\.\d+/.test(String(v)), `cortex.v 不像版本号：${JSON.stringify(v)}`)

// ── cortex.features：能力清单，得有真功能的名字 ──────────
const feats = cx.features
ok(Array.isArray(feats) && feats.length > 0, `cortex.features 不是数组：${JSON.stringify(feats)}`)
for (const k of ['extract', 'upsert', 'search', 'relations', 'distill']) {
  ok(feats.includes(k), `cortex.features 少声明了 ${k}：${JSON.stringify(feats)}`)
}

// ── amygdala.switches：13 个核团全开，且能关能开回 ───────
const sw = amy.switches
ok(sw && typeof sw === 'object', `amygdala.switches 不是对象：${JSON.stringify(sw)}`)
const swObj = typeof sw.list === 'function' ? sw.list() : sw
const feats2 = Array.isArray(swObj?.features) ? swObj.features : []
const nuclei = Array.isArray(swObj?.nuclei) ? swObj.nuclei : []
ok(feats2.length >= 5, `开关组的"功能"项太少：${JSON.stringify(feats2)?.slice(0, 160)}`)
ok(nuclei.length >= 3, `核团数量不对：${JSON.stringify(nuclei)?.slice(0, 160)}`)
const on = feats2.concat(nuclei).filter((n) => n.on !== false && n.enabled !== false)
ok(on.length === feats2.length + nuclei.length,
  `默认该全开，实际 ${on.length}/${feats2.length + nuclei.length}`)

// ── prefrontal.invariants：不变量是对象，且带"不许存内容"这条 ──
const inv = pfc.invariants
ok(inv && typeof inv === 'object', `prefrontal.invariants 不是对象：${JSON.stringify(inv)}`)
// 它是**函数**，不是数据——JSON.stringify 会把函数丢掉，上一版就因此误判成"空的"。
ok(typeof inv.noContent === 'function', `invariants.noContent 该是可调用的检查器，实际 ${typeof inv.noContent}`)
const invOut = inv.noContent({ text: '候选里带了原文' }, ['候选里带了原文'])
ok(invOut && typeof invOut === 'object', `不变量检查器没返回结果：${JSON.stringify(invOut)}`)
ok(Array.isArray(invOut.bad), `不变量检查器缺 bad 列表：${JSON.stringify(invOut)}`)

// ── hippocampus.layers：方法对象，能列出 5 层并开关 ──────
const layers = hip.layers
ok(layers && typeof layers === 'object', `hippocampus.layers 不是对象：${JSON.stringify(layers)}`)
const list = typeof layers.list === 'function' ? layers.list() : null
ok(Array.isArray(list) && list.length >= 5, `层清单不对：${JSON.stringify(list)?.slice(0, 160)}`)
if (layers.off && layers.on && layers.isOff) {
  layers.off('episodic')
  ok(layers.isOff('episodic') === true, `关掉 episodic 后 isOff 应为 true：${layers.isOff('episodic')}`)
  layers.on('episodic')
  ok(layers.isOff('episodic') === false, `开回 episodic 后 isOff 应为 false：${layers.isOff('episodic')}`)
} else {
  fails.push('layers 缺 off/on/isOff 之一，开关没得验')
}

// ── hippocampus.vectorReady：布尔值；这台机器没有向量，就如实 false ──
const vr = hip.vectorReady
ok(typeof vr === 'boolean', `vectorReady 该是布尔：${JSON.stringify(vr)}`)
ok(vr === false, `这台机器没有向量后端，vectorReady 该是 false；若变成 ${vr}，说明后端接上了，这条要跟着改`)

rmSync(root, { recursive: true, force: true })

if (fails.length) {
  console.log(`FAIL ${fails.length}:`)
  for (const f of fails) console.log(' - ' + f)
  process.exit(1)
}
console.log(`PASS 六个值/对象（v=${v}；features ${feats.length} 项；核团 ${nuclei.length} 全开；layers ${list.length} 层可开关；vectorReady=${vr} 如实）`)
process.exit(0)
