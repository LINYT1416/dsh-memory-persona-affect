// 接线检查：谁挂在共享拍子上。
//
// 历史：原来 hippocampus 和 cortex 的浅/深巩固都走 lib/clock.js 的 every()/dailyAt。
// 但实测证明：裸 setInterval 的探针每 15 秒准时写，而挂在 every() 上的任务一次都不触发。
// 两个器官都已改成自有的 setInterval，这个测试跟着改成"只认还留在拍子上的器官"，
// 并且明确断言它们不再挂回去，防止有人又接回去、悄悄坏掉。
//
//   node tests/clock-wiring.mjs
import { apply } from 'dsh-all'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { dirname, join } from 'node:path'

const entry = fileURLToPath(import.meta.resolve('dsh-all'))
const { stats, reset } = await import(pathToFileURL(join(dirname(entry), 'lib', 'clock.js')).href)

const fails = []
const ok = (c, m) => { if (!c) fails.push(m) }

const services = new Map()
const fakeAgent = {
  id: 'clock-agent',
  ctx: {
    systemPrompt: { context: () => () => {} },
    effect(fn) { if (typeof fn === 'function') fn() },
    on() { return () => {} },
    emit() { return true },
    get: (n) => ctx.get(n),
  },
}

const cleanups = []
function effect(fn) { if (typeof fn === 'function') cleanups.push(fn); return () => {} }

const ctx = {
  tools: { register: () => () => {} },
  webServer: { register: () => () => {} },
  agents: { list: () => [fakeAgent] },
  provide: (n, v) => services.set(n, v),
  set: (n, v) => services.set(n, v),
  get(n) {
    if (n === 'tools') return ctx.tools
    if (n === 'webServer') return ctx.webServer
    if (n === 'agents') return ctx.agents
    return services.get(n) || null
  },
  effect,
  on() { return () => {} },
  emit() { return true },
}

reset()
apply(ctx)

const names = stats().jobs.map((j) => j.name).sort()

// 还该留在拍子上的
for (const want of ['amygdala.tick']) {
  ok(names.includes(want), `拍子上缺 ${want}，实际有：${names.join(', ')}`)
}

// 已经改成自有 setInterval 的：不该再出现在拍子上
for (const gone of ['hippocampus.shallow', 'hippocampus.deep', 'cortex.shallow', 'cortex.deep']) {
  ok(!names.includes(gone), `${gone} 不该再挂在拍子上（拍子不走的宿主里会静默失效）`)
}

const byName = Object.fromEntries(stats().jobs.map((j) => [j.name, j]))
ok(byName['amygdala.tick']?.everyMs === 5 * 60_000, `amygdala 周期错：${byName['amygdala.tick']?.everyMs}`)

reset()

if (fails.length) {
  console.log(`FAIL ${fails.length}:`)
  for (const f of fails) console.log(' - ' + f)
  process.exit(1)
}
console.log(`PASS 拍子接线（拍子上 ${names.length} 个：${names.join(' / ')}；海马体与皮层都已改自有定时器）`)
process.exit(0)
