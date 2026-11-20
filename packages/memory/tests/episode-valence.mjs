// 情绪要带效价进 episode，并且能被 moodTrend 统计到。
//
// 之前这个检查只写在一个没有断言的探针脚本里（tests/_v.mjs）——它永远退出 0，
// 混在绿色集合里当"通过"。这个文件是它的正式版本：断言写死，红就是红。
//
//   node tests/episode-valence.mjs
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const root = mkdtempSync(join(tmpdir(), 'val-'))
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
const hip = services.get('memory.hippocampus')

await hip.write({ role: 'user', text: '难受，心里堵得慌', session: 'neg', valence: -0.6 })
await hip.settle({ force: true })

const epsRaw = await hip.episodes({ limit: 50 })
const eps = Array.isArray(epsRaw) ? epsRaw : (epsRaw?.episodes || [])
ok(eps.length >= 1, `没写出 episode（${eps.length} 条）`)

const emo = eps.filter((e) => Number.isFinite(Number(e.valence)))
ok(emo.length >= 1, `episode 里没有带效价的：${JSON.stringify(eps)?.[0]?.slice?.(0, 80) || JSON.stringify(eps?.slice?.(0, 1))}`)

const neg = emo.find((e) => Number(e.valence) <= -0.3)
ok(Boolean(neg), `负性情绪没带负效价：${JSON.stringify(emo.map((e) => ({ t: e.type, v: e.valence })))}`)

const trend = await hip.moodTrend({ days: 2 })
ok(trend?.ok === true, `moodTrend 没返回 ok：${JSON.stringify(trend)?.slice(0, 120)}`)
ok(Number(trend.withValence) >= 1, `moodTrend 没统计到带效价的 episode（withValence=${trend?.withValence}）`)
ok(Number(trend.avgValence) <= -0.3, `平均效价方向不对：${trend?.avgValence}（应 <= -0.3）`)
ok(Array.isArray(trend.trend) && trend.trend.length >= 1, `trend 明细为空：${JSON.stringify(trend?.trend)}`)
const day = trend.trend?.[0]
ok(Number(day?.n) >= 1, `trend 当天条数不对：${JSON.stringify(day)}`)

rmSync(root, { recursive: true, force: true })

if (fails.length) {
  console.log(`FAIL ${fails.length}:`)
  for (const f of fails) console.log(' - ' + f)
  process.exit(1)
}
console.log(`PASS 效价落库（episode ${eps.length} 条，带效价 ${emo.length} 条，最负 ${neg?.valence}；moodTrend avg ${trend.avgValence} / coverage ${trend.coverage}）`)
process.exit(0)
