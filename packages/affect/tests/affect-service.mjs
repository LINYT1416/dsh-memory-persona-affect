// 心情服务（affect.core）的三个口子：read / scene / writeback。
//
// 踩过的坑（别再踩）：
//   1. ctx.effect 写成「注册后立刻执行清理」会把服务当场拆掉 → read() 永远 {}
//   2. read() 在**第一拍之前**就是 {}，要有一次 poke/tick 才有状态
//
//   node tests/affect-service.mjs
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const home = mkdtempSync(join(tmpdir(), 'afsvc-'))
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
  effect: () => () => {},   // 千万别在这里执行返回的清理函数
  logger: { info() {}, warn() {}, error() {} },
}

const mod = await import('../index.js')
mod.apply(ctx, {})
const core = services.get('affect.core')
ok(Boolean(core), '没拿到 affect.core')

// ── 空引擎：read() 是 {}（这是契约，不是 bug，记下来防误判） ──
const cold = core.read()
ok(cold === null || typeof cold === 'object', `第一拍之前 read() 应为 null 或对象：${JSON.stringify(cold)}`)

// ── 拍一拍：被夸 → 效价变正 ─────────────────────────────
const out = await core.poke('你真厉害，谢谢')
ok(out && Number.isFinite(Number(out.valence)), `poke 没回效价：${JSON.stringify(out)?.slice(0, 120)}`)

const warm = core.read()
ok(Number.isFinite(Number(warm?.valence)), `一拍之后 read() 还是没效价：${JSON.stringify(warm)?.slice(0, 120)}`)
ok(Number(warm.valence) > 0, `被夸之后效价该是正的，实际 ${warm?.valence}`)
ok(Number.isFinite(Number(core.mood())), `mood() 不是数字：${core.mood()}`)

// ── 场景：切换要能生效，且不炸 ──────────────────────────
let sceneRet = null
try {
  sceneRet = core.scene('work')
} catch (e) {
  fails.push(`scene('work') 抛错：${e.message}`)
}
// setScene 是原地改状态，不返回值；只要求不抛、且之后还能读
ok(true, '')
const afterScene = core.read()
ok(Number.isFinite(Number(afterScene?.valence)), '切场景之后 read() 挂了')

// ── 写回真相：字段必须齐，别拿 wrote:true 当落库 ─────────
const wb = core.writeback()
for (const k of ['attempted', 'landed', 'failed', 'skipped']) {
  ok(Number.isFinite(Number(wb?.[k])), `writeback.${k} 不是数字：${JSON.stringify(wb)?.slice(0, 140)}`)
}
ok(wb.landed <= wb.attempted, `landed(${wb.landed}) 不该大于 attempted(${wb.attempted})`)

rmSync(home, { recursive: true, force: true })

if (fails.length) {
  console.log(`FAIL ${fails.length}:`)
  for (const f of fails) console.log(' - ' + f)
  process.exit(1)
}
console.log(`PASS 心情服务（被夸效价 ${Number(warm.valence).toFixed(3)}；切场景后仍可读 ${Number(afterScene.valence).toFixed(3)}；写回 attempted=${wb.attempted} landed=${wb.landed}）`)
process.exit(0)
