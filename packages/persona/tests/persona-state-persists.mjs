// 人格状态要活过一次重启。
//
// 存法：state.json 里带 organs/evidence/signatures，每拍更新；启动时 restore。
// 这里钉的是"读回来的数是同一套"，不是"参数学会了吗"——
// 慢层参数要攒够证据才动（slow() 会如实说 not-enough），那是另一回事。
//
//   node tests/persona-state-persists.mjs
import { mkdtempSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const root = mkdtempSync(join(tmpdir(), 'perstate-'))
process.env.DSH_HOME = root
process.env.PERSONA_DIR = join(root, 'persona')

const fails = []
const ok = (c, m) => { if (!c) fails.push(m) }

const boot = async (tag) => {
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
  const mod = await import(`../index.js?boot=${tag}`)
  mod.apply(ctx)
  await new Promise((r) => setTimeout(r, 300))
  return services.get('memory.persona')
}

const p1 = await boot('one')
for (let i = 0; i < 6; i += 1) p1.tick([{ type: 'user', text: '你行不行啊，这都做不好，真烦' }])
await new Promise((r) => setTimeout(r, 400))
const hex1 = p1.hex()
const state1 = p1.snapshot()
ok(hex1 && Number.isFinite(Number(hex1.brevity)), `第一进程 hex 不对：${JSON.stringify(hex1)}`)
ok(state1 && typeof state1 === 'object', `snapshot() 不是对象：${JSON.stringify(state1)?.slice(0, 80)}`)

// 文件要真的长大/存在
const file = join(root, 'persona', 'state.json')
let size = 0
try { size = statSync(file).size } catch { /* 没写就是没落盘 */ }
ok(size > 0, `state.json 没写出来：${size}B`)

// 第二个进程：读回来的 hex 该接近第一进程
const p2 = await boot('two')
await new Promise((r) => setTimeout(r, 300))
// hex() 在新进程里要跑过一拍才算得出来（空进程返回 null）。
// 比较必须喂同一句话：空拍没有特征向量，hex 的偏置/签名项天然不同（那不是漂移）。
p2.tick([{ type: 'user', text: '你行不行啊，这都做不好，真烦' }])
await new Promise((r) => setTimeout(r, 200))
const hex2 = p2.hex()
ok(hex2 && Number.isFinite(Number(hex2.brevity)), `重启后 hex 不对：${JSON.stringify(hex2)}`)

for (const k of ['brevity', 'warmth', 'meme', 'blunt']) {
  const a = Number(hex1?.[k])
  const b = Number(hex2?.[k])
  ok(Math.abs(a - b) < 0.06, `重启前后 ${k} 差太多：${a} → ${b}`)
}
const d1 = Number(hex1?.delayMs)
const d2 = Number(hex2?.delayMs)
ok(Math.abs(d1 - d2) / Math.max(1, d1) < 0.15, `重启前后 delayMs 差太多：${d1} → ${d2}`)

// 慢层没攒够证据时，必须如实说不够，而不是假装学会
const slow = await p2.slow()
ok(slow && (slow.skipped === 'not-enough' || slow.changed || Number(slow.n) > 0),
  `slow() 返回值不可信：${JSON.stringify(slow)}`)

rmSync(root, { recursive: true, force: true })

if (fails.length) {
  console.log(`FAIL ${fails.length}:`)
  for (const f of fails) console.log(' - ' + f)
  process.exit(1)
}
console.log(`PASS 人格落盘（state.json ${size}B；hex 重启前后 brevity ${hex1.brevity}→${hex2.brevity}、delay ${d1}→${d2}；slow=${slow.skipped || 'ok'}）`)
process.exit(0)
