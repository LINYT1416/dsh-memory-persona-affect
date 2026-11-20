// 人格插件的对外服务：health / lines / memoryPrior / params / tick。
//
// 背景（别再误判成 bug）：人格是"空着启动"的——没配 persona 时
// traits/hex/bias 就是 null，这不是坏了；lines() 仍要能给出默认的自述。
//
//   node tests/persona-service.mjs
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const home = mkdtempSync(join(tmpdir(), 'persona-'))
process.env.DSH_HOME = home

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

const mod = await import('../index.js')
mod.apply(ctx, {})
await new Promise((r) => setTimeout(r, 250))

const p = services.get('memory.persona')
ok(Boolean(p), '没拿到 memory.persona')

// ── 健康：装上了、能用 ─────────────────────────────────
const h = p.health?.()
ok(h?.ok === true, `health 不是 ok：${JSON.stringify(h)?.slice(0, 120)}`)
ok(h?.loaded === true, `health 说没装载：${JSON.stringify(h)?.slice(0, 120)}`)
ok(Object.keys(h?.organs || {}).length >= 4, `器官数不对：${JSON.stringify(Object.keys(h?.organs || {}))}`)

// ── 空人格：traits 为 null，但 lines 必须能说话 ─────────
ok(p.traits() === null, `空人格 traits 该是 null，实际 ${JSON.stringify(p.traits())?.slice(0, 80)}`)
const lines = p.lines()
ok(Array.isArray(lines) && lines.length >= 1, `lines 该给至少一句，实际 ${JSON.stringify(lines)}`)
ok(lines.every((s) => typeof s === 'string' && s.length > 0), `lines 里有空句：${JSON.stringify(lines)}`)

// ── 记忆优先参数：两个旋钮都在 0..1 ─────────────────────
const prior = p.memoryPrior()
for (const k of ['deepBias', 'salienceGain']) {
  const v = Number(prior?.[k])
  ok(Number.isFinite(v) && v >= 0 && v <= 1, `memoryPrior.${k} 越界：${prior?.[k]}`)
}

// ── 参数表：器官都在，数值有效 ─────────────────────────
const params = p.params()
const organs = Object.keys(params || {})
ok(organs.length >= 4, `参数表器官数不对：${JSON.stringify(organs)}`)
const strGain = Number(params?.str?.habitGain)
ok(Number.isFinite(strGain), `params.str.habitGain 不是数字：${params?.str?.habitGain}`)

// ── 走一拍：ticks 要涨，lines 还能说话 ─────────────────
const before = Number(p.health?.().ticks || 0)
p.tick([{ type: 'user', text: '今天累死了，不想说话', at: Date.now() }])
const after = Number(p.health?.().ticks || 0)
ok(after > before, `tick 之后 ticks 没涨：${before} → ${after}`)
const lines2 = p.lines()
ok(Array.isArray(lines2) && lines2.length >= 1, `走一拍后 lines 空了：${JSON.stringify(lines2)}`)

rmSync(home, { recursive: true, force: true })

if (fails.length) {
  console.log(`FAIL ${fails.length}:`)
  for (const f of fails) console.log(' - ' + f)
  process.exit(1)
}
console.log(`PASS 人格服务（health ok/loaded；空人格 traits=null 但 lines「${lines[0]}」；memoryPrior deepBias=${prior.deepBias} salienceGain=${prior.salienceGain.toFixed(2)}；tick ${before}→${after} 拍）`)
process.exit(0)
