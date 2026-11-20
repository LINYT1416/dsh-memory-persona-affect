// 情绪腔也不许蒸成"事实"：皮层只该收发生过的/成立的事，不该把【情绪】当事实存下来。
//
//   node tests/cortex-clean.mjs
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const root = mkdtempSync(join(tmpdir(), 'cortexclean-'))
process.env.DSH_HOME = root
process.env.HIPPOCAMPUS_DIR = join(root, 'hippocampus')
process.env.CORTEX_DIR = join(root, 'cortex')

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
  get: (n) => (n === 'tools' ? ctx.tools : n === 'webServer' ? ctx.webServer : n === 'agents' ? ctx.agents : services.get(n) || null),
  on: () => () => {},
  emit: () => true,
  effect: () => () => {},
  logger: { info() {}, warn() {}, error() {} },
}

const { apply } = await import('../index.js')
apply(ctx)
const hip = services.get('memory.hippocampus')
const cortex = services.get('memory.cortex')

// 一件真事 + 一条情绪写回
await hip.write({ role: 'user', text: '我叫示例用户，做机器人结构设计的，最近在找工作', session: 'c1', force: true })
await hip.write({
  role: 'assistant',
  text: '【情绪】委屈：他说"你行不行啊"',
  kind: 'affect',
  force: true,
  valence: -0.6,
  session: 'c1',
})

await hip.settle({ force: true })
await hip.consolidate({ mode: 'shallow' })

const st = await cortex.stats()
ok(Number(st?.facts) >= 1, `皮层一条事实都没有：${JSON.stringify(st)?.slice(0, 200)}`)

const hit = await cortex.search('委屈')
const hitText = JSON.stringify(hit ?? '')
ok(hitText.length > 2, 'cortex.search 返回空了')
ok(!/【情绪】/.test(hitText) && !/委屈/.test(hitText), `情绪腔被当事实存进皮层：${hitText.slice(0, 240)}`)

const ask = await cortex.ask('我叫什么名字')
const askText = JSON.stringify(ask ?? '')
ok(/示例用户|机器人|结构/.test(askText), `皮层答不出刚写的事实：${askText.slice(0, 200)}`)

rmSync(root, { recursive: true, force: true })

if (fails.length) {
  console.log(`FAIL ${fails.length}:`)
  for (const f of fails) console.log(' - ' + f)
  process.exit(1)
}
console.log('PASS 皮层干净（真事蒸成事实 / 情绪腔没变事实 / ask 答得出）')
process.exit(0)
