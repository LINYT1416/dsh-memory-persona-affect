// 重试安全：同一条消息被重复写入，不能变成两条记忆。
//
// 真实场景：网络抖动重发、断线重连、用户连按两次发送。
// 如果每条都变成新事实，她会"记两遍"，冲突检测也会自己跟自己打架。
//
//   node tests/idempotency.mjs
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const root = mkdtempSync(join(tmpdir(), 'idem-'))
process.env.DSH_HOME = root
process.env.HIPPOCAMPUS_DIR = join(root, 'hippocampus')
process.env.CORTEX_DIR = join(root, 'cortex')
process.env.AMYGDALA_DIR = join(root, 'amygdala')

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
const cx = services.get('memory.cortex')
await cx.whenReady()

// ── 直接 upsert：三次同一条事实 ─────────────────────────
for (let i = 0; i < 3; i += 1) {
  cx.upsert([{ subject: '我', predicate: '居所', object: '威海', supportIds: [`e${i + 1}`] }])
  await new Promise((r) => setTimeout(r, 30))
}
const st = await cx.stats()
ok(Number(st.facts) === 1, `重复写三次变成了 ${st.facts} 条事实（该 1 条）`)
ok(Number(st.edges) === 2, `重复写三次边数 ${st.edges}（该 2 条：subject + object）`)

const hits = (await cx.search('威海'))?.hits || []
ok(hits.length === 1, `同一个问题搜出 ${hits.length} 条（该 1 条）`)
if (hits.length) {
  const rel = await cx.relations(hits[0].cellId)
  ok(rel.length === 2, `关系边 ${rel.length} 条（该 2 条）`)
  // 三条证据：权重应累加，而不是新建边
  const minW = Math.min(...rel.map((e) => Number(e.w)))
  ok(minW >= 3, `证据累积没体现在权重上（最小 w=${minW}，三份证据该 ≥3）`)
  ok(new Set(rel.map((e) => `${e.from}>${e.to}:${e.kind}`)).size === rel.length,
    `关系里有重复边：${JSON.stringify(rel)}`)
}

// ── 真实路径：同一句话写三次 ───────────────────────────
const text = '我住在威海，在一家机器人公司上班'
for (let i = 0; i < 3; i += 1) {
  await hip.write({ role: 'user', text, session: 's1', force: true })
}
await hip.settle({ force: true })
await hip.consolidate({ mode: 'shallow' })

const st2 = await cx.stats()
const factsAfter = Number(st2.facts)
ok(factsAfter >= 1, `真实路径一条事实都没抽出来：${factsAfter}`)
ok(factsAfter <= 2, `同一句话写三次抽出了 ${factsAfter} 条事实（该 ≤2，不能一条变三份）`)

const hits2 = (await cx.search('威海'))?.hits || []
ok(hits2.length >= 1, `真实路径搜不到：${hits2.length}`)
ok(hits2.length <= 2, `同一句话写三次，搜索出现 ${hits2.length} 条（该 ≤2）`)

rmSync(root, { recursive: true, force: true })

if (fails.length) {
  console.log(`FAIL ${fails.length}:`)
  for (const f of fails) console.log(' - ' + f)
  process.exit(1)
}
console.log(`PASS 重试安全（upsert×3 → facts 1 / edges 2 / w≥3；真实路径×3 → facts ${factsAfter}、搜索 ${hits2.length} 条）`)
process.exit(0)
