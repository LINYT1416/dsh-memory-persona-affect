// 真向量：不是"有向量文件"就算过，要能靠语义找到东西。
//
// 这台机器没有 npm，但 ~/.dsh/hippocampus 里装着 @xenova/transformers 2.17.2
// （onnxruntime-node 1.14.0 也在），bge-small-zh-v1.5 的量化模型已经缓存在
// ~/.dsh/hippocampus/models。vectors.js 会按 环境变量 → 本地包 → 老安装 的顺序找。
//
//   node tests/vectors-real.mjs
// 断言四件事：
//   1. 嵌入是真模型：维度 512，向量有限、不同文本不同向
//   2. 索引覆盖率：warmVectors 之后 have == total
//   3. 语义召回：查询和被记的话**没有共同词**，也要能命中
//   4. 关键词召回没被破坏：老路径仍然准
// 模型不可用时打印 SKIP 并 exit 0（别的机器上不该红），但这台机器必须真跑。
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const root = mkdtempSync(join(tmpdir(), 'vecreal-'))
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
const cx = services.get('memory.cortex')
await (cx?.whenReady?.() ?? Promise.resolve())

const vec = await import('../organs/hippocampus/lib/vectors.js')

// ── 1. 嵌入本身 ────────────────────────────────────────
const a = await vec.embed('中介收钱跑路了')
if (!a || !a.length) {
  console.log('SKIP 没有可用向量模型（没有 @xenova/transformers 或模型缓存）')
  rmSync(root, { recursive: true, force: true })
  process.exit(0)
}
ok(a.length === 512, `维度该 512（bge-small-zh），实际 ${a.length}`)
ok(a.every((x) => Number.isFinite(x)), '向量里有非有限数')
const b = await vec.embed('被中介骗了钱')
const c = await vec.embed('今天吃了牛肉面')
const simNear = vec.cosine(a, b)
const simFar = vec.cosine(a, c)
ok(simNear > simFar + 0.15,
  `语义没分开：近 ${simNear.toFixed(3)} vs 远 ${simFar.toFixed(3)}（差该 > 0.15）`)
ok(simNear > 0.5, `"中介跑路"和"被骗钱"的余弦只有 ${simNear.toFixed(3)}，太低`)

// ── 2. 索引覆盖 ────────────────────────────────────────
const lines = [
  '他在公司被领导当众骂了一顿，很难堪',
  '晚上吃了牛肉面，加了两个蛋',
  '周末去海边散步，风很大但很舒服',
]
for (const t of lines) await hip.write({ role: 'user', text: t, session: 's1', force: true })
await hip.settle({ force: true })

if (typeof hip.warmVectors === 'function') await hip.warmVectors(50)
let st = await hip.stats()
ok(Number(st.dim) === 512, `stats.dim 该 512，实际 ${st.dim}`)
ok(Number(st.total) >= 3, `索引行数该 ≥3，实际 ${st.total}`)
ok(Number(st.have) === Number(st.total),
  `向量覆盖不全：${st.have}/${st.total}（warmVectors 之后该全覆盖）`)
ok(Number(st.ratio) === 1, `覆盖率该 1，实际 ${st.ratio}`)

// ── 3. 语义召回：查询里没有"领导/骂" ───────────────────
const sem = await hip.recall('上班受气', { k: 3 })
const semHits = sem?.hits || []
ok(semHits.length > 0, '语义查询一条都没召回')
ok(Boolean(sem?.vectorReady), `recall.vectorReady 该 true，实际 ${sem?.vectorReady}`)
const top = String(semHits[0]?.summary || semHits[0]?.text || semHits[0]?.brief || '')
ok(top.includes('领导') || top.includes('骂'),
  `语义查询没命中"被领导骂"那条，实际第一名：${top.slice(0, 40)}`)
ok(semHits.some((h) => String(h.why || '').includes('vector')),
  `命中里没有 vector 这一路：${JSON.stringify(semHits.map((h) => h.why))}`)

// ── 4. 关键词召回没坏 ──────────────────────────────────
const kw = await hip.recall('牛肉面', { k: 3 })
const kwTop = String(kw?.hits?.[0]?.summary || kw?.hits?.[0]?.text || kw?.hits?.[0]?.brief || '')
ok(kwTop.includes('牛肉面'), `关键词查询没命中：${kwTop.slice(0, 40)}`)

rmSync(root, { recursive: true, force: true })

if (fails.length) {
  console.log(`FAIL ${fails.length}:`)
  for (const f of fails) console.log(' - ' + f)
  process.exit(1)
}
console.log(`PASS 真向量（dim ${a.length}；近 ${simNear.toFixed(3)} / 远 ${simFar.toFixed(3)}；` +
  `覆盖 ${st.have}/${st.total}；语义查询命中「${top.slice(0, 12)}」；关键词查询正常）`)
process.exit(0)
