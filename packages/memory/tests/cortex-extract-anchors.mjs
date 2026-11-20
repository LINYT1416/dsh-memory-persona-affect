// 皮层的骨架口：extract（从 episode 抽事实）/ anchorsOf（事实回指哪几段）/ handoff / concepts / expand。
//
// 注意契约：extract 收的是 **episode 对象**（{id,text,...}），不是字符串——
// 传字符串会得到 []，那是调用方用错，不是抽取坏了。
//
//   node tests/cortex-extract-anchors.mjs
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const root = mkdtempSync(join(tmpdir(), 'cxex-'))
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

// ── extract：一句有事实的话，抽出居所 ──────────────────
const ep = { id: 'ep-t1', text: '我住在威海，在一家机器人公司上班', at: Date.now(), session: 's1' }
const facts = await cx.extract(ep)
ok(Array.isArray(facts), `extract 没返回数组：${JSON.stringify(facts)}`)
ok(facts.length >= 1, `有事实的句子没抽出东西：${JSON.stringify(facts)}`)
const hasCity = facts.some((f) => String(f.object ?? '').includes('威海') || String(f.text ?? '').includes('威海'))
ok(hasCity, `没抽出"威海"：${JSON.stringify(facts).slice(0, 200)}`)
for (const f of facts) {
  ok(String(f.subject ?? '').length > 0, `抽出的事实缺主语：${JSON.stringify(f)}`)
  ok(String(f.predicate ?? '').length > 0, `抽出的事实缺谓词：${JSON.stringify(f)}`)
}

// ── extract：一句闲话，不硬抽 ─────────────────────────
const chat = await cx.extract({ id: 'ep-t2', text: '今天天气不错啊', at: Date.now(), session: 's1' })
ok(Array.isArray(chat) && chat.length === 0, `闲话不该抽出事实：${JSON.stringify(chat)}`)

// ── anchorsOf：事实能回指到来源 episode ───────────────
cx.upsert([{ subject: '我', predicate: '居所', object: '威海', supportIds: ['ep-t1'] }])
await new Promise((r) => setTimeout(r, 120))
const hits = (await cx.search('威海'))?.hits || []
ok(hits.length >= 1, `写完搜不回来：${hits.length}`)
const anchors = cx.anchorsOf(hits[0].cellId)
ok(anchors && String(anchors.id) === String(hits[0].cellId), `anchorsOf 返回的 id 不对：${JSON.stringify(anchors)}`)
ok(Array.isArray(anchors.episodes) && anchors.episodes.includes('ep-t1'),
  `回指丢了来源：${JSON.stringify(anchors.episodes)}`)

// 不存在的 id：给空结构，不炸
const missing = cx.anchorsOf('c_not_exist')
ok(missing && Array.isArray(missing.episodes) && missing.episodes.length === 0,
  `不存在的 id 该给空：${JSON.stringify(missing)}`)

// ── handoff：必须是布尔（海马体按真假判断）───────────
const hand = cx.handoff('ep-t1')
ok(typeof hand === 'boolean', `handoff 不是布尔：${typeof hand}（${JSON.stringify(hand)}）`)

// ── concepts / expand：形状对、不给空壳 ───────────────
const con = cx.concepts('工作')
ok(con && typeof con === 'object', `concepts 没返回对象：${JSON.stringify(con)}`)
ok(Array.isArray(con.items), `concepts.items 不是数组：${JSON.stringify(con)}`)
ok(typeof con.mode === 'string' && con.mode.length > 0, `concepts 没给 mode：${JSON.stringify(con)}`)

const ex = cx.expand('上班')
ok(typeof ex === 'string' && ex.length > 0, `expand 没返回字符串：${JSON.stringify(ex)}`)
ok(ex.includes('上班'), `expand 把原词弄丢了：${ex}`)

rmSync(root, { recursive: true, force: true })

if (fails.length) {
  console.log(`FAIL ${fails.length}:`)
  for (const f of fails) console.log(' - ' + f)
  process.exit(1)
}
console.log(`PASS 皮层骨架（抽 ${facts.length} 条含威海；闲话抽 ${chat.length} 条；回指 ${anchors.episodes.join(',')}；handoff=${hand}；concepts ${con.items.length} 条；expand「${ex}」）`)
process.exit(0)
