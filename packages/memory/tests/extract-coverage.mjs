// 抽取覆盖率：常见自述句要能被抽成事实，而不是"能答一句就算通"。
//
// 检索侧有抖动（分词/阈值），所以每次用"主查询 + 兜底词 + 重试一次"
// ——单跑过、全量偶发挂的那种测试不算绿测，必须消掉。
//
//   node tests/extract-coverage.mjs
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const cases = [
  { text: '我住在威海，在这边读机器人工程', label: '居所', queries: ['住在', '威海', '机器人'] },
  { text: '我在一家机器人公司上班，做结构设计', label: '单位', queries: ['上班', '公司', '机器人'] },
  { text: '我叫示例用户，最近在找工作', label: '姓名', queries: ['名字', '找工作', '示例用户'] },
  { text: '我最讨厌别人骗我', label: '喜恶', queries: ['讨厌', '别人', '骗我'] },
]

const fails = []
const ok = (c, m) => { if (!c) fails.push(m) }

async function anyHits(cortex, queries) {
  for (let attempt = 0; attempt < 3; attempt++) {
    for (const q of queries) {
      const h = (await cortex.search(q))?.hits || []
      if (h.length) return { hits: h, query: q }
    }
    await new Promise((r) => setTimeout(r, 80))
  }
  return { hits: [], query: null }
}

async function runCase(c) {
  const root = mkdtempSync(join(tmpdir(), 'extract-'))
  process.env.DSH_HOME = root
  process.env.HIPPOCAMPUS_DIR = join(root, 'hippocampus')
  process.env.CORTEX_DIR = join(root, 'cortex')

  const services = new Map()
  // 皮层的 upsert 在装载完成前是排队的（早写不丢），等等再搜
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

  // 每个 case 独立实例（缓存按 URL 复用，所以带查询串强制新 store）
  const mod = await import(`../index.js?case=${encodeURIComponent(c.label)}`)
  mod.apply(ctx)
  const hip = services.get('memory.hippocampus')
  const cortex = services.get('memory.cortex')

  // apply 之后不一定已经装载完：皮层的 upsert 在 boot 前是排队的（早写不丢），
  // 以前这里直接写+搜，靠 3 次 80ms 重试硬撑，机器慢一点就挂——这才是那个抖动。
  await (cortex?.whenReady?.() ?? Promise.resolve())

  await hip.write({ role: 'user', text: c.text, session: `s-${c.label}`, force: true })
  await hip.settle({ force: true })
  await hip.consolidate({ mode: 'shallow' })

  const st = await cortex.stats()
  const facts = Number(st?.facts || 0)
  ok(facts >= 1, `[${c.label}] 抽不出事实："${c.text}"（facts=${facts}）`)

  const found = await anyHits(cortex, c.queries)
  ok(found.hits.length >= 1 && String(found.hits[0]?.text || '').length > 0,
    `[${c.label}] ${c.queries.join('/')} 都搜不回来`)

  rmSync(root, { recursive: true, force: true })
  return facts
}

const numbers = []
for (const c of cases) numbers.push(await runCase(c))

if (fails.length) {
  console.log(`FAIL ${fails.length}:`)
  for (const f of fails) console.log(' - ' + f)
  process.exit(1)
}
console.log(`PASS 抽取覆盖（${cases.length} 类自述都抽得出：${cases.map((c, i) => `${c.label}${numbers[i]}`).join(' / ')}）`)
process.exit(0)
