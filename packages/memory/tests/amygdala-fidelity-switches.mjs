// 杏仁核最后两块：失真随时间掉（fidelitySplit），以及各核开关（switches）。
//
// 失真这块最容易写成"返回四个数就算对"。这里钉方向：
//   越久 → confidence 越低、drift 越高；certainty/vividness 是当时属性，不该跟着掉。
//
//   node tests/amygdala-fidelity-switches.mjs
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const root = mkdtempSync(join(tmpdir(), 'amyfs-'))
process.env.DSH_HOME = root
process.env.HIPPOCAMPUS_DIR = join(root, 'hippocampus')
process.env.CORTEX_DIR = join(root, 'cortex')
process.env.AMYGDALA_DIR = join(root, 'amygdala')

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
const amy = services.get('memory.amygdala')

// ── 失真：越久，把握越低、漂移越高 ────────────────────
const d0 = amy.fidelitySplit(0.9, 0.9, 0)
const d30 = amy.fidelitySplit(0.9, 0.9, 30)
const d365 = amy.fidelitySplit(0.9, 0.9, 365)

for (const [name, v] of [['0天', d0], ['30天', d30], ['365天', d365]]) {
  ok(v && typeof v === 'object', `${name} 没返回对象：${JSON.stringify(v)}`)
  for (const k of ['confidence', 'certainty', 'vividness', 'drift']) {
    ok(Number.isFinite(Number(v[k])), `${name} 的 ${k} 不是数字：${JSON.stringify(v)}`)
    ok(Number(v[k]) >= 0 && Number(v[k]) <= 1, `${name} 的 ${k} 越界：${v[k]}`)
  }
}

ok(Number(d0.confidence) > Number(d30.confidence), `30 天后把握该降：${d0.confidence} → ${d30.confidence}`)
ok(Number(d30.confidence) > Number(d365.confidence), `一年后把握该更低：${d30.confidence} → ${d365.confidence}`)
ok(Number(d0.drift) < Number(d365.drift), `越久漂移该越大：${d0.drift} → ${d365.drift}`)
ok(Number(d0.certainty) === Number(d365.certainty), `certainty 是"当时有多确定"，不该随时间掉：${d0.certainty} → ${d365.certainty}`)
ok(Number(d0.vividness) === Number(d365.vividness), `vividness 是"当时有多鲜明"，不该随时间掉：${d0.vividness} → ${d365.vividness}`)

// ── 开关：默认全开，关掉一层就真关 ────────────────────
// list() 的形状是 { features:[{name,on}], nuclei:[{name,on}] }
const sw = amy.switches
ok(sw && typeof sw === 'object', `switches 不是对象：${typeof sw}`)

function flatten(raw) {
  const out = []
  if (!raw || typeof raw !== 'object') return out
  for (const group of Object.values(raw)) {
    if (!Array.isArray(group)) continue
    for (const x of group) if (x && x.name) out.push({ name: String(x.name), on: Boolean(x.on) })
  }
  return out
}

const list0 = flatten(sw.list())
ok(list0.length > 0, `switches.list 里没东西：${JSON.stringify(sw.list())}`)
ok(list0.every((x) => x.on === true), `默认该全开：${JSON.stringify(list0)}`)

const target = list0[0].name
sw.off(target)
ok(sw.isOff(target) === true, `off 之后 isOff 该是 true：${target}`)
const after = flatten(sw.list()).find((x) => x.name === target)
ok(after && after.on === false, `off 之后 list 里该显示关：${JSON.stringify(sw.list())}`)

sw.on(target)
ok(sw.isOff(target) === false, `on 之后 isOff 该是 false：${target}`)
ok(flatten(sw.list()).find((x) => x.name === target)?.on === true, `on 之后 list 该显示开：${target}`)

// 核级开关：用核的名字（bla/cea/itc/mea），调得通、不抛
const nuclei = flatten(sw.list()).filter((x) => ['bla', 'cea', 'itc', 'mea'].includes(x.name))
ok(nuclei.length > 0, `没找到核级开关：${JSON.stringify(sw.list())}`)
let nThrew = null
try {
  const n = nuclei[0].name
  sw.nucleusOff(n)
  const offNow = sw.nucleusIsOff(n)
  ok(offNow === true, `核「${n}」关掉之后 nucleusIsOff 该是 true：${offNow}`)
  sw.nucleusOn(n)
  ok(sw.nucleusIsOff(n) === false, `核「${n}」开回来之后该是 false`)
} catch (e) { nThrew = e }
ok(!nThrew, `核级开关调用抛了：${nThrew?.message}`)

// reset 之后回到全开
sw.off(target)
sw.reset?.()
ok(flatten(sw.list()).every((x) => x.on === true), `reset 之后该全开：${JSON.stringify(sw.list())}`)

rmSync(root, { recursive: true, force: true })

if (fails.length) {
  console.log(`FAIL ${fails.length}:`)
  for (const f of fails) console.log(' - ' + f)
  process.exit(1)
}
console.log(`PASS 杏仁核失真/开关（把握 ${d0.confidence}→${d30.confidence}→${d365.confidence}；漂移 ${d0.drift}→${d365.drift}；certainty 不动 ${d0.certainty}；开关 ${list0.length} 个默认全开，关「${target}」能关回来）`)
process.exit(0)
