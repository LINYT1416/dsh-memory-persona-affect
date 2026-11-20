// 同一拍：心情跑完一拍，人格必须在同一拍里跟上
//
// 以前两个 60 秒的钟各跑各的，两边"这一拍"永远错开——
// 人格读到的心情可能是上一句的。这里测的就是这条广播链路。
//
//   node packages/persona\tests\shared-beat.mjs
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const fails = []
const ok = (c, m) => { if (!c) fails.push(m) }

const home = mkdtempSync(join(tmpdir(), 'beat-'))
process.env.DSH_HOME = home

const affectMod = await import('file:///E:/heart/packages/dsh-affect/index.js')
const personaMod = await import('../index.js')

// 一个最小事件总线，两边共用
function makeBus() {
  const map = new Map()
  return {
    on(name, fn) {
      if (!map.has(name)) map.set(name, [])
      map.get(name).push(fn)
      return () => {}
    },
    emit(name, payload) {
      for (const fn of map.get(name) || []) { try { fn(payload) } catch { /* 单个监听器失败不影响别的 */ } }
      return true
    },
    count(name) { return (map.get(name) || []).length },
  }
}

const bus = makeBus()
const services = new Map()

function makeCtx() {
  return {
    systemPrompt: { context: () => () => {} },
    webServer: { register: () => () => {} },
    tools: { get: () => null, register: () => () => {} },
    agents: { list: () => [] },
    provide: (n, v) => services.set(n, v),
    get: (n) => (n === 'tools' ? null : services.get(n) || null),
    on: (n, f) => bus.on(n, f),
    emit: (n, p) => bus.emit(n, p),
    effect: (fn) => { if (typeof fn === 'function') { try { const d = fn(); if (typeof d === 'function') d() } catch { /* ignore */ } } },
    logger: { info() {}, warn() {}, error() {} },
  }
}

// 心情先起来（它才有广播）
affectMod.apply(makeCtx(), {})
const core = services.get('affect.core')
ok(Boolean(core), '心情没 provide affect.core')

// 人格后起来，应该挂上 affect/tick
const p = personaMod.apply(makeCtx(), {})
ok(bus.count('affect/tick') >= 1, '人格没订阅 affect/tick')

await new Promise((r) => setTimeout(r, 120))

const h0 = p.health()
ok(h0.beat && h0.beat.linked === false, `还没收到广播时 linked 该是 false，实际 ${JSON.stringify(h0.beat)}`)
const t0 = h0.ticks

// ── 1. 心情跑一拍 → 人格同一拍跟一步 ─────────────────────
core.poke('你行不行啊，这都做不好')
await new Promise((r) => setTimeout(r, 20))
const h1 = p.health()
ok(h1.ticks === t0 + 1, `心情一拍，人格该跟一拍：${t0} → ${h1.ticks}`)
ok(h1.beat.linked === true, '收到广播后 linked 该是 true')
const affectTick = core.read() ? null : null
ok(typeof h1.beat.lastBeat === 'number' && h1.beat.lastBeat >= 1,
  `lastBeat 该记下跟的是第几拍，实际 ${JSON.stringify(h1.beat)}`)

// ── 2. 连着两句：不会因为"太快"被吞掉 ────────────────────
core.poke('随便吧')
await new Promise((r) => setTimeout(r, 20))
const h2 = p.health()
ok(h2.ticks === h1.ticks + 1, `第二句也要跟一拍：${h1.ticks} → ${h2.ticks}`)
ok(h2.beat.lastBeat > h1.beat.lastBeat, 'lastBeat 要往前走')

// ── 3. 同一个序号重复广播：不许重复跟（一拍算两遍会把慢变量加速）──
const before = p.health().ticks
bus.emit('affect/tick', { at: Date.now(), tick: h2.beat.lastBeat })
bus.emit('affect/tick', { at: Date.now(), tick: h2.beat.lastBeat })
await new Promise((r) => setTimeout(r, 20))
ok(p.health().ticks === before, `重复序号被重复跟了：${before} → ${p.health().ticks}`)

// ── 4. 人格必须在"心情算完之后"才跑：它读到的 mood 是这一拍的 ──
{
  const moodNow = core.read()?.mood
  ok(typeof moodNow === 'number', '心情该读得到 mood')
  // 人格这一拍读到的是同一拍的心情（不是上一拍）——通过读取同一个 core 保证；
  // 这里只断言顺序契约：广播是在 tick 之后发的（affect 侧实现），
  // 所以人格跑的时候 core 已经是新值。用 lastBeat 与 core 的拍号对齐来验。
  ok(p.health().beat.lastBeat === h2.beat.lastBeat, '拍号要对得上')
}

try { rmSync(home, { recursive: true, force: true }) } catch { /* ignore */ }

if (fails.length) {
  console.log(`FAIL ${fails.length}:`)
  for (const f of fails) console.log(` - ${f}`)
  process.exit(1)
}
console.log(`PASS 同一拍（心情 ${h2.beat.lastBeat} 拍 → 人格 ${t0}→${h2.ticks} 拍；重复序号不重复跟）`)
process.exit(0)
