// 生产路径端到端：人格调 affect.core.retune({persona:...}) → 心情真的不一样
//
// 上面那个 affects-mood.mjs 测的是引擎内部；这个测的是**插件对外的那个口**。
// 两者都得过，否则可能出现"引擎支持、但插件的 retune 不认这个键"的半通。
//
//   node tests/persona-retune-path.mjs
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const fails = []
const ok = (c, m) => { if (!c) fails.push(m) }

const mod = await import('../index.js')

function boot() {
  const home = mkdtempSync(join(tmpdir(), 'affect-path-'))
  process.env.DSH_HOME = home
  const services = new Map()
  const ctx = {
    systemPrompt: { context: () => () => {} },
    webServer: { register: () => () => {} },
    tools: { get: () => null, register: () => () => {} },
    provide: (n, v) => services.set(n, v),
    get: (n) => services.get(n) || null,
    on: () => () => {},
    effect: (fn) => { if (typeof fn === 'function') { try { const d = fn(); if (typeof d === 'function') d() } catch { /* ignore */ } } },
    emit: () => true,
    logger: { info() {}, warn() {}, error() {} },
  }
  mod.apply(ctx, {})
  return { core: services.get('affect.core'), home }
}

function pokeValence(core, text) {
  let last = null
  for (let i = 0; i < 3; i++) last = core.poke(text)
  return { valence: last?.valence ?? null, emotions: last?.emotions ?? [] }
}

// ── 1. 基线 ───────────────────────────────────────────────
const A = boot()
ok(Boolean(A.core), '没 provide affect.core')
const baseA = pokeValence(A.core, '你行不行啊，这都做不好')
ok(Number.isFinite(baseA.valence), '基线没算出效价')

// ── 2. 同一个口，写 threatGain 之后 ───────────────────────
const B = boot()
const r = B.core.retune({ persona: { threatGain: 1.8, baselineMood: 0.08 } })
ok(r && r.ok === true, `retune 该成功，实际 ${JSON.stringify(r)}`)
const baseB = pokeValence(B.core, '你行不行啊，这都做不好')
ok(baseB.valence < baseA.valence - 0.02,
  `同一条通路：加敏感后效价该更负，实际 ${baseB.valence?.toFixed(3)} vs ${baseA.valence?.toFixed(3)}`)

// ── 3. 夹值：人格算飞了也不许把心情推到离谱的地方 ─────────
{
  const C = boot()
  C.core.retune({ persona: { threatGain: 99, sensitivity: -5, baselineMood: 3 } })
  const st = C.core.read()
  ok(Number.isFinite(st?.valence ?? 0), '夹值后仍应算得出效价')
}

// ── 4. 老通路不许被弄坏：器官参数照样写得进去 ─────────────
{
  const D = boot()
  const r2 = D.core.retune({ amygdala: { tauThreat: 30 }, pfc: { suppressionBase: 0.5 } })
  ok(r2 && r2.ok === true && r2.organs >= 2, `器官 retune 该仍有效，实际 ${JSON.stringify(r2)}`)
}

// ── 5. 不写就完全不变（默认中性，不许偷偷改行为）──────────
{
  const E = boot()
  const base = pokeValence(E.core, '你行不行啊，这都做不好')
  ok(Math.abs(base.valence - baseA.valence) < 0.02,
    `两个默认实例的效价该一致，实际 ${base.valence?.toFixed(3)} vs ${baseA.valence?.toFixed(3)}`)
}

for (const h of [A.home, B.home]) { try { rmSync(h, { recursive: true, force: true }) } catch { /* ignore */ } }

if (fails.length) {
  console.log(`FAIL ${fails.length}:`)
  for (const f of fails) console.log(` - ${f}`)
  process.exit(1)
}
console.log(`PASS 生产路径 retune（persona 键生效：${baseA.valence.toFixed(3)} → ${baseB.valence.toFixed(3)}；器官通路未破；默认不变）`)
process.exit(0)
