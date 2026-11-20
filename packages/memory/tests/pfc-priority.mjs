// 前额叶的巩固优先级：奖励/自我相关/目标相关要真的把顺序推上去。
//
// 坑：它读的是 cand.summary，不是 cand.text —— 传错字段会得到两条一样的 0.36，
// 看起来像"算了个寂寞"。这个测试同时钉住字段名和方向。
//
//   node tests/pfc-priority.mjs
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const root = mkdtempSync(join(tmpdir(), 'pfc-'))
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
  get: (n) => services.get(n) || null,
  on: () => () => {},
  emit: () => true,
  effect: () => () => {},
  logger: { info() {}, warn() {}, error() {} },
}

const { apply } = await import('../index.js')
apply(ctx)
const pfc = services.get('memory.prefrontal')
const now = Date.now()

const plain = { id: 'plain', summary: '今天买了包子', at: now }
const selfish = { id: 'self', summary: '老板夸我干得好，还给了奖金', at: now }

const ranked = await pfc.priority([plain, selfish])
ok(Array.isArray(ranked) && ranked.length === 2, `priority 应回两条，实际 ${JSON.stringify(ranked)?.slice(0, 120)}`)
ok(ranked[0].id === 'self', `自我相关那条该排第一，实际第一是 ${ranked[0].id}`)
const sSelf = ranked.find((x) => x.id === 'self')?.score
const sPlain = ranked.find((x) => x.id === 'plain')?.score
ok(Number(sSelf) > Number(sPlain), `自我相关的分数该更高：${sSelf} vs ${sPlain}`)
ok((ranked.find((x) => x.id === 'self')?.parts || []).some((p) => p.name === 'self' && p.value > 0.4),
  `self 分量没起来：${JSON.stringify(ranked.find((x) => x.id === 'self')?.parts)}`)

// 目标相关：同一条，带上 goal 之后 goal 分量必须 > 0
const withGoal = await pfc.priority([{ id: 'job', summary: '明天去面试找工作', at: now }], { goal: '找工作' })
const jobParts = withGoal[0]?.parts || []
const goalPart = jobParts.find((p) => p.name === 'goal')
ok(goalPart && goalPart.value > 0, `goal 分量没起来：${JSON.stringify(jobParts)}`)

// 空候选不许炸
const empty = await pfc.priority([])
ok(Array.isArray(empty) && empty.length === 0, `空候选该回空数组：${JSON.stringify(empty)}`)

rmSync(root, { recursive: true, force: true })

if (fails.length) {
  console.log(`FAIL ${fails.length}:`)
  for (const f of fails) console.log(' - ' + f)
  process.exit(1)
}
console.log(`PASS 前额叶优先级（自我相关 ${sSelf} > 普通 ${sPlain}；goal 分量 ${goalPart.value}；空候选不炸）`)
process.exit(0)
