// 关系图：事实进库时必须挂上 subject/object 边。
//
// 抓到的 bug：主链路（海马体 → 前额叶 → cortex.upsert）只 store.put，
// 从不调用 schema-graph 的 attach —— 于是 facts 有、edges 永远 0，
// relations() 一直返回空数组：看起来有"关系检索"这个功能，实际从来没跑过。
//
// 这里钉的是：写两条事实之后，边真的存在，且 relations 能报出方向。
//
//   node tests/cortex-relations-edges.mjs
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const root = mkdtempSync(join(tmpdir(), 'cxrel-'))
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
await cx.whenReady()

// ── 写两条同主语、不同宾语的事实 ─────────────────────
const res = cx.upsert([
  { subject: '我', predicate: '居所', object: '威海', supportIds: ['e1'] },
  { subject: '我', predicate: '职业', object: '学生', supportIds: ['e1'] },
])
ok(Number(res?.accepted) === 2, `两条没都收下：${JSON.stringify(res)}`)
await new Promise((r) => setTimeout(r, 200))

// ── 边必须真的建了 ───────────────────────────────────
const st = await cx.stats()
ok(Number(st.facts) === 2, `facts 不对：${st.facts}`)
ok(Number(st.edges) >= 2,
  `事实写进去了但一条边都没有（edges=${st.edges}）——关系检索等于死功能`)

// ── relations：能报出方向和类型 ──────────────────────
const hits = (await cx.search('威海'))?.hits || []
ok(hits.length >= 1, `搜不回来：${hits.length}`)
const rel = await cx.relations(hits[0].cellId)
ok(Array.isArray(rel) && rel.length >= 1, `relations 还是空的：${JSON.stringify(rel)}`)
const kinds = rel.map((e) => e.kind)
ok(kinds.includes('subject') || kinds.includes('object'),
  `边的类型不对：${JSON.stringify(kinds)}`)
for (const e of rel) {
  ok(String(e.from || '').length > 0 && String(e.to || '').length > 0, `边端点缺失：${JSON.stringify(e)}`)
  ok(Number(e.w) > 0, `边权重该大于 0：${JSON.stringify(e)}`)
}

// 未知 id：空数组、不炸
const none = await cx.relations('c_nope')
ok(Array.isArray(none) && none.length === 0, `未知 id 该给空：${JSON.stringify(none)}`)

rmSync(root, { recursive: true, force: true })

if (fails.length) {
  console.log(`FAIL ${fails.length}:`)
  for (const f of fails) console.log(' - ' + f)
  process.exit(1)
}
console.log(`PASS 关系图（facts ${st.facts}、edges ${st.edges}；relations ${rel.length} 条，类型 ${[...new Set(kinds)].join('/')}）`)
process.exit(0)
