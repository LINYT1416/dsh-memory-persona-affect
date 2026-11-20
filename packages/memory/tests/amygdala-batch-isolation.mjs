// 杏仁核的批量口与"这是不是测试数据"：observeMany / scoreMany / alerts / prioritize / isTest / testIds / modulate。
//
// 方向要钉的：
//   · 上火的话打分必须高于平淡的话（不是"都有分"就算过）
//   · prioritize 送不出去时要明说原因，不许静默成功
//   · isTest/testIds 是测试隔离用：默认不该把正常记忆说成测试
//
//   node tests/amygdala-batch-isolation.mjs
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const root = mkdtempSync(join(tmpdir(), 'amybatch-'))
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
const amy = services.get('memory.amygdala')

// ── observeMany：一批进去，逐条回分数 ─────────────────
const many = await amy.observeMany([
  { text: '那个中介骗了我，我气死了', session: 's1', at: Date.now(), id: 'e1' },
  { text: '今天天气还不错', session: 's1', at: Date.now(), id: 'e2' },
])
ok(Array.isArray(many) && many.length === 2, `observeMany 没按条返回：${JSON.stringify(many)?.slice(0, 160)}`)
ok(many.map((x) => x.id).join(',') === 'e1,e2', `id 顺序不对：${many.map((x) => x.id).join(',')}`)
for (const r of many) {
  ok(Number.isFinite(Number(r.score)), `有条没给分数：${JSON.stringify(r).slice(0, 120)}`)
  ok(r.modulators && typeof r.modulators === 'object', `有条没给调制量：${JSON.stringify(r).slice(0, 120)}`)
}

// ── scoreMany：上火的话必须比平淡的话高 ───────────────
const scored = await amy.scoreMany([{ text: '我气死了，真恶心' }, { text: '今天天气不错' }])
ok(Array.isArray(scored) && scored.length === 2, `scoreMany 没按条返回：${JSON.stringify(scored)?.slice(0, 160)}`)
const angry = Number(scored[0]?.score)
const calm = Number(scored[1]?.score)
ok(Number.isFinite(angry) && Number.isFinite(calm), `分数不是数字：${angry} / ${calm}`)
ok(angry > calm, `上火的话(${angry}) 该高于平淡的话(${calm})`)

// ── alerts：数组；不承诺一定有内容 ────────────────────
const alerts = amy.alerts()
ok(Array.isArray(alerts), `alerts 不是数组：${JSON.stringify(alerts)}`)

// ── prioritize：送不出去要说原因 ──────────────────────
const pri = await amy.prioritize([{ id: 'a', text: '中介' }, { id: 'b', text: '天气' }])
ok(pri && typeof pri === 'object', `prioritize 没返回对象：${JSON.stringify(pri)}`)
ok(typeof pri.sent === 'boolean', `prioritize 没给 sent：${JSON.stringify(pri)}`)
if (pri.sent === false) {
  ok(String(pri.reason || '').length > 0, `prioritize 说没送出去却不说为什么：${JSON.stringify(pri)}`)
}

// ── 测试隔离：正常条目不该被标成测试 ──────────────────
ok(typeof amy.isTest('e1') === 'boolean', `isTest 不是布尔：${typeof amy.isTest('e1')}`)
ok(amy.isTest('e1') === false, `正常记忆被标成了测试数据：${JSON.stringify(amy.isTest('e1'))}`)
const ids = amy.testIds()
ok(Array.isArray(ids), `testIds 不是数组：${JSON.stringify(ids)}`)

// ── modulate：四种调制量都在，类型对 ──────────────────
const mod = amy.modulate()
ok(mod && typeof mod === 'object', `modulate 没返回对象：${JSON.stringify(mod)}`)
ok(typeof mod.depth === 'string' && mod.depth.length > 0, `modulate.depth 不对：${JSON.stringify(mod)}`)
ok(Number.isFinite(Number(mod.days)) && Number(mod.days) > 0, `modulate.days 不对：${JSON.stringify(mod)}`)
ok(Number.isFinite(Number(mod.rounds)) && Number(mod.rounds) >= 1, `modulate.rounds 不对：${JSON.stringify(mod)}`)
ok(typeof mod.summaryLevel === 'string' && mod.summaryLevel.length > 0, `modulate.summaryLevel 不对：${JSON.stringify(mod)}`)

rmSync(root, { recursive: true, force: true })

if (fails.length) {
  console.log(`FAIL ${fails.length}:`)
  for (const f of fails) console.log(' - ' + f)
  process.exit(1)
}
console.log(`PASS 杏仁核批量（observeMany ${many.length} 条；上火 ${angry} > 平淡 ${calm}；alerts ${alerts.length} 条；prioritize ${pri.sent ? '已送' : '没送:' + pri.reason}；正常条目 isTest=${amy.isTest('e1')}；modulate ${mod.depth}/${mod.days}天/${mod.rounds}轮/${mod.summaryLevel}）`)
process.exit(0)
