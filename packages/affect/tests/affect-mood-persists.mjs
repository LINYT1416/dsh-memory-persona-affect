// 心情要活过一次重启。
//
// affect 的存法是"每一拍跑完就落盘"（state.json），所以验证必须**真的跑一拍**——
// 只 poke 不 tick 的话，文件里还是上一拍的值，看起来像丢了，其实只是没存。
// 这条测试用 ctx.on('session/event') 真跑一拍，然后再起一个实例读回来。
//
//   node tests/affect-mood-persists.mjs
import { mkdtempSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const root = mkdtempSync(join(tmpdir(), 'moodpersist-'))
process.env.DSH_HOME = root
process.env.AFFECT_DIR = join(root, 'affect')

const fails = []
const ok = (c, m) => { if (!c) fails.push(m) }

const boot = async (tag) => {
  const services = new Map()
  const handlers = new Map()
  const ctx = {
    systemPrompt: { context: () => () => {} },
    webServer: { register: () => () => {} },
    tools: { register: () => () => {}, get: () => null },
    agents: { list: () => [] },
    provide: (n, v) => services.set(n, v),
    set: (n, v) => services.set(n, v),
    get: (n) => services.get(n) || null,
    on: (name, fn) => { handlers.set(name, fn); return () => handlers.delete(name) },
    emit: () => true,
    effect: () => () => {},
    logger: { info() {}, warn() {}, error() {} },
  }
  const mod = await import(`../index.js?boot=${tag}`)
  await (mod.apply || mod.default)(ctx)
  await new Promise((r) => setTimeout(r, 300))
  return { services, handlers }
}

// 第一次进程：喂几句难受的话，跑一拍让它落盘
const one = await boot('one')
const core1 = one.services.get('affect.core')
const io1 = one.services.get('affect.io')
const moodBefore = Number(io1.mood())
ok(Number.isFinite(moodBefore), `mood() 不是数：${io1.mood()}`)

for (const text of ['我真的好难过，想哭', '撑不住了，太累了', '有点想一个人待着']) {
  await core1.poke(text)
}
// 真跑一拍（timer 之外的唯一触发口）
const onEvent = one.handlers.get('session/event')
ok(typeof onEvent === 'function', 'affect 没挂 session/event —— 这条测试的前提变了')
if (onEvent) {
  onEvent({ id: 's1' }, { type: 'user/message', data: { text: '我真的好难过，想哭，撑不住了' } })
}
await new Promise((r) => setTimeout(r, 500))

const moodAfterTick = Number(io1.mood())
ok(moodAfterTick < moodBefore - 0.001,
  `喂了难受的话，心情该往下走：${moodBefore} → ${moodAfterTick}（还是同一个数值说明没吃到）`)

const statePath = join(root, 'affect', 'state.json')
let size = 0
try { size = statSync(statePath).size } catch { /* 没文件就是没落盘 */ }
ok(size > 0, `state.json 没写出来：${size}B`)

// 第二次进程：同一份数据，心情该接着上一拍
const two = await boot('two')
const moodRestored = Number(two.services.get('affect.io').mood())
ok(Math.abs(moodRestored - moodAfterTick) < 0.02,
  `重启后心情没接上：落盘前 ${moodAfterTick}，重启后 ${moodRestored}`)

rmSync(root, { recursive: true, force: true })

if (fails.length) {
  console.log(`FAIL ${fails.length}:`)
  for (const f of fails) console.log(' - ' + f)
  process.exit(1)
}
console.log(`PASS 心情落盘（${moodBefore} → ${moodAfterTick} → 重启 ${moodRestored}；state.json ${size}B）`)
process.exit(0)
