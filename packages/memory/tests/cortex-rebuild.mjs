// 皮层重建（cortex.rebuild）：会归档全部 cell 再从 episode 重抽。
//
// 这里抓过一个真 bug：重建把 cell 全归档了，但 distill 因为"没有新东西"什么都不做，
// 恢复循环又跳过 archived —— 事实还在库里、stats 数得到，search 却一条都搜不到。
// rebuild 当时报 rebuilt:true。所以断言不能看返回值，要看"重建后还搜得到"。
//
//   node tests/cortex-rebuild.mjs
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const root = mkdtempSync(join(tmpdir(), 'cxrb-'))
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

// 先写一条事实（没有对应 episode 文本，最能暴露"重抽不出来"的场景）
cx.upsert([{ subject: '我', predicate: '居所', object: '威海', supportIds: ['e1'] }])
await new Promise((r) => setTimeout(r, 150))

const before = (await cx.search('威海'))?.hits || []
ok(before.length >= 1, `重建前就搜不到：${before.length}`)
const statsBefore = await cx.stats()
ok(Number(statsBefore.facts) >= 1, `重建前 facts 就不对：${statsBefore.facts}`)

// ── 重建：返回什么不重要，搜得到才重要 ─────────────────
const out = await cx.rebuild()
ok(out && typeof out === 'object', `rebuild 没返回对象：${JSON.stringify(out)}`)
ok(out.rebuilt === true, `rebuild 没说自己完成：${JSON.stringify(out)}`)

const after = (await cx.search('威海'))?.hits || []
ok(after.length >= 1,
  `重建后搜不到了（返回值 ${JSON.stringify(out)}）——事实还在库里但检索丢了，这是重建的经典退化`)

const statsAfter = await cx.stats()
ok(Number(statsAfter.facts) >= 1, `重建后 facts 掉了：${statsBefore.facts} → ${statsAfter.facts}`)
ok(Number(statsAfter.facts) === Number(statsBefore.facts),
  `重建不该改变事实条数：${statsBefore.facts} → ${statsAfter.facts}`)

// ── 再重建一次：幂等，不许越重建越少 ───────────────────
const out2 = await cx.rebuild()
const after2 = (await cx.search('威海'))?.hits || []
ok(after2.length >= 1, `第二次重建后搜不到：${JSON.stringify(out2)}`)
ok(Number((await cx.stats()).facts) === Number(statsBefore.facts),
  `第二次重建改了事实条数`)

rmSync(root, { recursive: true, force: true })

if (fails.length) {
  console.log(`FAIL ${fails.length}:`)
  for (const f of fails) console.log(' - ' + f)
  process.exit(1)
}
console.log(`PASS 皮层重建（搜前 ${before.length} 条 → 重建后 ${after.length} 条；facts ${statsBefore.facts}→${statsAfter.facts}；第二次重建仍 ${after2.length} 条，factsRestored=${out.factsRestored}）`)
process.exit(0)
