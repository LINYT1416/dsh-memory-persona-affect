// 判决层两处：皮层的 judge（两条事实是不是同一件事）和前额叶的 judge（这批候选留谁、排第几）。
//
// 约定：cortex.judge 收的是 **cellId 字符串**，不是事实对象（传对象会得到 not-found）。
//
// 这里钉的是"判决的方向"，不是"字段有没有"：
//   · 同一条 → same:true 且置信高
//   · 同主语同谓词不同值 → same:false 且置信低
//   · 前额叶的排序：rank 唯一、从 1 开始，且 keep 的必须给理由
//
//   node tests/cortex-prefrontal-judge.mjs
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const root = mkdtempSync(join(tmpdir(), 'cxj-'))
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
const cx = services.get('memory.cortex')
const pfc = services.get('memory.prefrontal')
await cx.whenReady()

// ── 造两条同键不同值的事实 ─────────────────────────────
cx.upsert([{ subject: '我', predicate: '手机号', object: '13800000001', supportIds: ['e1'] }])
cx.upsert([{ subject: '我', predicate: '手机号', object: '13800000002', supportIds: ['e2'] }])
await new Promise((r) => setTimeout(r, 150))
const hits = (await cx.search('手机号'))?.hits || []
ok(hits.length >= 2, `两条没都进库：${hits.length}`)
const idA = hits[0].cellId
const idB = hits[1].cellId

// ── 同一条：判 same，置信要高 ─────────────────────────
const self = await cx.judge(idA, idA)
ok(self?.same === true, `同一条该判 same：${JSON.stringify(self)}`)
ok(Number(self.confidence) >= 0.5, `同一条置信太低：${self.confidence}`)
ok(String(self.bodyId || '').length > 0, `同一条该给出 bodyId：${JSON.stringify(self)}`)

// ── 不同值：不许判 same ───────────────────────────────
const diff = await cx.judge(idA, idB)
ok(diff?.same === false, `不同手机号不该判 same：${JSON.stringify(diff)}`)
ok(Number(diff.confidence) < 0.5, `不同值却给了高置信：${diff.confidence}`)

// ── 不存在的 id：不许炸 ───────────────────────────────
let unknownThrew = null
let unknown = null
try { unknown = await cx.judge('c_nope', idA) } catch (e) { unknownThrew = e }
ok(!unknownThrew, `judge 不存在的 id 抛了：${unknownThrew?.message}`)
ok(unknown?.same === false, `找不到的该判"不是同一件"：${JSON.stringify(unknown)}`)

// ── relations：数组，且不存在的 id 给空 ───────────────
const rel = await cx.relations(idA)
ok(Array.isArray(rel), `relations 不是数组：${JSON.stringify(rel)}`)
const relNone = await cx.relations('c_nope')
ok(Array.isArray(relNone) && relNone.length === 0, `不存在的 id 该给空：${JSON.stringify(relNone)}`)

// ── 前额叶 judge：排序与理由 ──────────────────────────
const cands = [
  { id: 'c_low', text: '我手机号13800000002', score: 0.4 },
  { id: 'c_high', text: '我手机号13800000001', score: 0.9 },
]
const verdict = await pfc.judge(cands, '我的手机号是多少')
const vs = verdict?.verdicts || []
ok(Array.isArray(vs) && vs.length === 2, `前额叶没判两条：${JSON.stringify(verdict)?.slice(0, 160)}`)
const ranks = vs.map((v) => Number(v.rank)).sort((a, b) => a - b)
ok(ranks[0] === 1 && ranks[1] === 2, `rank 该是 1、2：${JSON.stringify(ranks)}`)
ok(vs.every((v) => typeof v.keep === 'boolean'), `keep 不是布尔：${JSON.stringify(vs.map((v) => v.keep))}`)
ok(vs.every((v) => Array.isArray(v.why) && v.why.length >= 1),
  `keep 了却没给理由：${JSON.stringify(vs.map((v) => v.why))}`)
const top = vs.find((v) => Number(v.rank) === 1)
ok(top.id === 'c_high', `分高的该排第一：${JSON.stringify(top.id)}`)

rmSync(root, { recursive: true, force: true })

if (fails.length) {
  console.log(`FAIL ${fails.length}:`)
  for (const f of fails) console.log(' - ' + f)
  process.exit(1)
}
console.log(`PASS 判决层（同条 same=${self.same} 置信 ${self.confidence}；不同值 same=${diff.same} 置信 ${diff.confidence}；未知 id 不炸；前额叶排第一 ${top.id}，2 条各带理由）`)
process.exit(0)
