// 离线冒烟：用一个假 ctx 把器官的 apply() 跑一遍。
// 这一步以前从来没有过——所以只能靠"你重启一次我看一眼"来发现 ctx.effect 用法错这种问题。
// 现在改成：本地先跑通 apply，再让你重启。
import * as organ from '../organs/hippocampus/index.js'

let fail = 0
const ok = (c, m) => { if (!c) { fail++; console.log('FAIL', m) } else { console.log('  ok:', m) } }

// 记录定时器：apply 里注册的 setInterval 都应该留下
const timers = []
const realSet = globalThis.setInterval
const realClear = globalThis.clearInterval
globalThis.setInterval = (fn, ms) => {
  const h = { fn, ms, unref() {} }
  timers.push(h)
  return h
}
globalThis.clearInterval = () => {}

// 假 ctx：只实现器官用到的那几个面
const registered = { tools: [], events: [], effects: 0, provided: [] }
const ctx = {
  on: (name, fn) => { registered.events.push(name); return () => {} },
  effect: (fn) => { registered.effects++; return typeof fn === 'function' ? fn() : undefined },
  get: (id) => (id === 'sessions' ? { flush() {} } : null),
  provide: (id, api) => { registered.provided.push(id) },
  tools: { register: (t) => registered.tools.push(t?.name || t) },
  webServer: { register: () => {} },
  agents: { list: () => [] },
  logger: { info() {}, warn() {}, error() {} },
}

let error = null
try {
  const dispose = organ.apply(ctx)
  if (typeof dispose === 'function') dispose()
} catch (e) {
  error = e
}

console.log('apply 抛错:', error ? String(error.message || error) : '无')
ok(!error, '假 ctx 下 apply() 不应抛错')
ok(registered.tools.length > 0, `应注册工具（实际 ${registered.tools.length} 个）`)
const delays = timers.map((t) => t.ms)
ok(delays.includes(15000), `应有 15 秒的定时器（实际 ${JSON.stringify(delays)}）`)
ok(delays.includes(10 * 60 * 1000), '应有 10 分钟的巩固定时器')

globalThis.setInterval = realSet
globalThis.clearInterval = realClear

console.log(fail ? `FAIL ${fail}` : 'PASS 离线冒烟（apply 不抛错 / 工具注册 / 定时器注册）')
process.exit(fail ? 1 : 0)
