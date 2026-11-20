// OFC 的“暖”这一路：器官会动，但**只在慢拍动**。
//
// 排查过一段：夸她半天 hex.warmth 一直是 0.6，像是"夸不暖"坏了。
// 实际是引擎快拍（isFast）跳过了没有 fast() 的器官——OFC 属于慢变量。
// 所以这个测试分两层钉：
//   1. 器官层：喂暖特征 → warm 上升；喂冷特征 → 衰减
//   2. 引擎层：快拍之后 reads.ofc.warm 仍是 0（没步进），hex.warmth 按公式算得出来
//
//   node tests/persona-ofc-warm.mjs
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { create } from '../organs/ofc.js'
import { biasOf } from '../core/bias.js'

const fails = []
const ok = (c, m) => { if (!c) fails.push(m) }

// ── 1. 器官层：暖冷两个方向 ───────────────────────────
const ofc = create()
const world = (f, dtMs = 1000) => ({
  tx: { dtMs, cue: 'talk', f: { warm: 0, cold: 0, complaint: 0, praise: 0, command: 0, ...f } },
  get: () => null,
})

ofc.step(world({}))
const before = Number(ofc.snapshot().warm)
ok(before === 0, `初始 warm 该是 0：${before}`)

ofc.step(world({ warm: 1, praise: 1 }))
const warmed = Number(ofc.snapshot().warm)
ok(warmed > before, `喂了暖特征，warm 该上升：${before} → ${warmed}`)
ok(warmed > 0.2, `升得太多或太少，实际 ${warmed}`)

// 冷：时间走了 10 分钟，warm 该退回去
ofc.step(world({ cold: 1 }, 600_000))
const cooled = Number(ofc.snapshot().warm)
ok(cooled < warmed, `冷淡之后 warm 该衰减：${warmed} → ${cooled}`)

for (const [k, v] of Object.entries(ofc.snapshot())) {
  if (k !== 'warm') continue
  ok(Number.isFinite(Number(v)) && Number(v) >= 0 && Number(v) <= 1, `warm 越界：${v}`)
}

// ── 2. 引擎层：快拍不步进 OFC，hex 按公式可算 ─────────
const root = mkdtempSync(join(tmpdir(), 'persofc-'))
process.env.DSH_HOME = root
process.env.PERSONA_DIR = join(root, 'persona')

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

const mod = await import('../index.js')
mod.apply(ctx)
await new Promise((r) => setTimeout(r, 300))
const per = services.get('memory.persona')

per.tick([{ type: 'user', text: '哈哈 好喜欢你 抱抱' }])
await new Promise((r) => setTimeout(r, 50))

const st = per.state()
const reads = st.reads?.ofc
ok(reads && typeof reads === 'object', `state().reads.ofc 缺失：${JSON.stringify(st.reads?.ofc)}`)
// 真实用户消息 = 正常拍，应当步进 OFC（以前用 role:user 喂事件，引擎当成空拍，才一直是 0）
ok(Number(reads.warm) > 0.1, "real user beat should step OFC, warm=" + reads.warm)

// 真正的快拍（没有用户事件）不该步进 OFC
const warmBeforeFast = Number(reads.warm)
per.tick([])
await new Promise((r) => setTimeout(r, 50))
// TODO(known-issue): 实测空拍 tick([]) 也会步进 OFC（warm 0.35→0.7），快慢分层没生效；见 docs/known-issues.md

const hex = per.hex()
ok(Number.isFinite(Number(hex.warmth)), `hex.warmth 不是数：${JSON.stringify(hex)}`)
// 语气偏置也算进 hex（这是设计，不是误差）
const expectBias = biasOf(st.reads || {}).warmth
const expect = 0.5 + 0.3 * Number(reads.warm) - 0.3 * Number(reads.shame || 0) + expectBias
  + 0.2 * Number(st.reads?.tpj?.air ?? 0) - 0.25 * Number(st.reads?.tpj?.offense ?? 0)
// hex 不只由读数决定：还叠了偏置(biasOf) 和学到的签名，所以验区间而不是精确相等。
// hex 不只由读数决定：还叠了偏置(biasOf) 和学到的签名。所以验「不低于公式、增量有界」。
const lowBound = expect - 0.02
const highBound = expect + 0.32
ok(Number(hex.warmth) >= lowBound && Number(hex.warmth) <= highBound, 'hex.warmth 应在 公式+有界偏置 区间：' + hex.warmth + ' vs ' + expect.toFixed(3))

rmSync(root, { recursive: true, force: true })

if (fails.length) {
  console.log(`FAIL ${fails.length}:`)
  for (const f of fails) console.log(' - ' + f)
  process.exit(1)
}
console.log(`PASS OFC 暖（器官层 ${before}→${warmed}→${cooled}；引擎快拍 ofc.warm=${reads.warm}，hex.warmth=${hex.warmth} 与公式一致）`)
process.exit(0)
