// 入站写入不能丢：装载完成之前 upsert 的候选必须先攒着，boot 之后补写。
//
// 这条是真丢过的：store 在 bootstrap 里会被磁盘内容覆盖，早写的当场消失；
// 而海马体一启动就调 upsert，所以"一开始记的东西全没了"。
//
//   node tests/cortex-inbound-queue.mjs
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const root = mkdtempSync(join(tmpdir(), 'inbound-'))
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

// ── 装载还没完成就写：必须进队列，不能假装收下 ───────────
const early = cx.upsert([{ subject: '我', predicate: '手机号', object: '13800000001', supportIds: ['e1'] }])
ok(early?.queued === true, `早写该进队列，实际 ${JSON.stringify(early)}`)
ok(Number(early?.accepted) === 0, `早写不该谎报 accepted=1，实际 ${early?.accepted}`)

// 等它装完
await new Promise((r) => setTimeout(r, 400))

// ── 队列里的那条必须真的落库、能搜到 ───────────────────
const hits = (await cx.search('手机号', { limit: 5 }))?.hits || []
ok(hits.length >= 1, `早写的那条没落库（搜到 ${hits.length} 条）`)
ok(hits.some((h) => String(h.text).includes('13800000001')), `落库的文本里没有早写那条：${hits.map((h) => h.text).join(' | ')}`)

// ── 装载之后再写：直接收，并且能判出冲突 ───────────────
const late = cx.upsert([{ subject: '我', predicate: '手机号', object: '13800000002', supportIds: ['e2'] }])
ok(Number(late?.accepted) === 1, `装载后写入该 accepted=1，实际 ${JSON.stringify(late)}`)

const all = (await cx.search('手机号', { limit: 5 }))?.hits || []
ok(all.length === 2, `两条都该在，实际 ${all.length} 条`)

const cf = await cx.conflicts()
ok(Array.isArray(cf) && cf.length >= 1, `同谓词不同值该记冲突，实际 ${JSON.stringify(cf)?.slice(0, 160)}`)
ok(String(cf[0]?.reason) === 'value-mismatch', `冲突原因该是 value-mismatch，实际 ${cf[0]?.reason}`)
ok(cf[0]?.state === 'open', `新冲突该是 open，实际 ${cf[0]?.state}`)

rmSync(root, { recursive: true, force: true })

if (fails.length) {
  console.log(`FAIL ${fails.length}:`)
  for (const f of fails) console.log(' - ' + f)
  process.exit(1)
}
console.log(`PASS 入站不丢（早写 queued=true → 补写后两条都在；冲突 ${cf.length} 条 ${cf[0].reason}/${cf[0].state}）`)
process.exit(0)
