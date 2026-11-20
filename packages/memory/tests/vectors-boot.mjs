// 冷启动预热：不开手动开关，重启之后向量自己要铺上。
//
// 这条钉的是一个真事：线上重启完 vectors.json 一直是旧的、vectorReady 还是 false——
// 因为启动时 primeIndex 和 warmVectors 是并发跑的，索引还没建好 warm 拿 0 行，
// 而且没有重试，从此再也不会铺。
//
//   node tests/vectors-boot.mjs
// 不手动调用 warmVectors，只等启动那条路自己跑完。
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const root = mkdtempSync(join(tmpdir(), 'vecboot-'))
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

// 模型不在就跳过（别的机器不该因为没模型变红）
const vec = await import('../organs/hippocampus/lib/vectors.js')
const probe = await vec.embed('预热测试')
if (!probe || !probe.length) {
  console.log('SKIP 没有可用向量模型')
  rmSync(root, { recursive: true, force: true })
  process.exit(0)
}

// 冷启动之前先有一条记忆，让启动预热有东西可铺
await hip.write({ role: 'user', text: '今天被领导当众骂了一顿，很难堪', session: 's1', force: true })
await hip.settle({ force: true })

// 启动预热在 5s 后开始，等它跑完（不手动调 warmVectors）
const deadline = Date.now() + 40000
let st = await hip.stats()
while (Date.now() < deadline) {
  st = await hip.stats()
  if (Number(st.have) > 0) break
  await new Promise((r) => setTimeout(r, 1000))
}

ok(Number(st.have) > 0, `冷启动没把向量铺上：have=${st.have}/${st.total}`)
ok(Number(st.ratio) > 0, `覆盖率还是 0：${st.ratio}`)
ok(Number(st.dim) === 512, `dim 该 512，实际 ${st.dim}`)

if (Number(st.have) > 0) {
  const r = await hip.recall('上班受气', { k: 2 })
  ok(Boolean(r?.vectorReady), `recall.vectorReady 该 true，实际 ${r?.vectorReady}`)
  const top = String(r?.hits?.[0]?.summary || r?.hits?.[0]?.brief || '')
  ok(top.includes('领导') || top.includes('骂'), `语义没命中：${top.slice(0, 30)}`)
}

rmSync(root, { recursive: true, force: true })

if (fails.length) {
  console.log(`FAIL ${fails.length}:`)
  for (const f of fails) console.log(' - ' + f)
  process.exit(1)
}
console.log(`PASS 冷启动预热（不手动触发，${st.have}/${st.total} 铺上，dim ${st.dim}）`)
process.exit(0)
