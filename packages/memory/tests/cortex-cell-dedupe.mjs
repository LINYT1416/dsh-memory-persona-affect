// 皮层"记忆重复"回归：
// 1) 同一批候选反复 upsert，cell 数不能涨（按 cellKey 合并）
// 2) cells.jsonl 里同一 id 重复多行时，加载会自愈压缩
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-dedupe-'))
process.env.CORTEX_DIR = TMP
process.env.CORTEX_DATA_DIR = TMP

const svc = Object.create(null)
const noop = () => {}
const put = (n, v) => { svc[n] = v; svc[String(n).replace(/^memory\./, '')] = v }
const ctx = {
  get: (n) => svc[n] ?? svc[String(n).replace(/^memory\./, '')],
  provide: put, set: put,
  on: () => ({ dispose: noop }),
  effect: (f) => { try { f() } catch {} return noop },
  logger: { info: noop, warn: noop, error: noop, debug: noop },
  emit: noop,
  systemPrompt: { context: () => () => {} },
  webServer: { register: () => () => {} },
  tools: { register: () => () => {}, get: () => null },
  agents: { list: () => [] },
}

let fail = 0
let cellsAfterMulti = 0
const ok = (c, m, d = '') => { if (!c) { fail++; console.log('   FAIL', m, d) } else console.log('  ok:', m) }

const mod = await import('file:///E:/memory/dsh-all/organs/cortex/index.js')
mod.apply(ctx)
await new Promise((r) => setTimeout(r, 1500))
const C = svc['memory.cortex']
ok(Boolean(C), '拿到 memory.cortex')

const facts = [
  { subject: '主人', predicate: '计划', object: '明天想去海边走走', kind: 'fact', text: '明天想去海边走走' },
  { subject: '主人', predicate: '经历', object: '我妈打电话说我爸住院了', kind: 'event', text: '我妈打电话说我爸住院了' },
]

for (let i = 0; i < 5; i += 1) {
  await C.upsert({ episodeId: `ep_${i}`, facts })
}
await new Promise((r) => setTimeout(r, 600))
const st = await C.stats()
const cells1 = Number(st.cells ?? st.total ?? 0)
ok(cells1 === facts.length, `重复 upsert 后 cell 数应等于 ${facts.length}，实际 ${cells1}`)

// 同一句话被抽成两种面（fact + event）：应按文本合并成一条，其余进 aliases
{
  const multi = [
    { subject: '主人', predicate: '计划', object: '下周去爬山', kind: 'fact', text: '下周去爬山' },
    { subject: '主人', predicate: '经历', object: '下周去爬山', kind: 'event', text: '下周去爬山' },
  ]
  await C.upsert({ episodeId: 'ep_multi', facts: multi })
  await new Promise((r) => setTimeout(r, 400))
  const stx = await C.stats()
  const now = Number(stx.cells ?? stx.total ?? 0)
  ok(now === cells1 + 1, `同一句话多面应合并成 1 条（期望 ${cells1 + 1}，实际 ${now}）`)
  cellsAfterMulti = now
}

// 同一条 episode 被切出不同 object 截断：应按 anchor+正文合并
{
  const same = (obj) => ({ episodeId: 'ep_trunc', facts: [{ subject: '主人', predicate: '希望', object: obj, kind: 'fact', text: '基于 PartnerOf 这件事我希望你记住' }] })
  await C.upsert(same('基于 PartnerOf 这件事'))
  await C.upsert(same('基于 Part'))
  await C.upsert(same('基于 '))
  await new Promise((r) => setTimeout(r, 400))
  const st2 = await C.stats()
  const n = Number(st2.cells ?? st2.total ?? 0)
  ok(n === cellsAfterMulti + 1, `同一条 episode 的不同截断应合并成 1 条（期望 ${cellsAfterMulti + 1}，实际 ${n}）`)
  cellsAfterMulti = n
}

// 模拟磁盘膨胀：同一 id 抄 30 行
const file = path.join(TMP, 'cells.jsonl')
const rows = fs.readFileSync(file, 'utf8').trim().split('\n').filter(Boolean)
const bloated = []
for (let i = 0; i < 30; i += 1) bloated.push(...rows)
fs.writeFileSync(file, bloated.join('\n') + '\n', 'utf8')
const before = fs.readFileSync(file, 'utf8').trim().split('\n').length

// 重新挂一份（新实例）触发自愈压缩
const svc2 = Object.create(null)
const ctx2 = { ...ctx, get: (n) => svc2[n] ?? svc2[String(n).replace(/^memory\./, '')], provide: (n, v) => { svc2[n] = v; svc2[String(n).replace(/^memory\./, '')] = v }, set: (n, v) => { svc2[n] = v; svc2[String(n).replace(/^memory\./, '')] = v } }
const mod2 = await import('file:///E:/memory/dsh-all/organs/cortex/index.js?fresh=1')
mod2.apply(ctx2)
await new Promise((r) => setTimeout(r, 1500))
const after = fs.readFileSync(file, 'utf8').trim().split('\n').length
ok(after < before, `加载时应压缩重复行（${before} → ${after}）`)

const st2 = await svc2['memory.cortex'].stats()
const cells2 = Number(st2.cells ?? st2.total ?? 0)
ok(cells2 === cellsAfterMulti, `压缩后 cell 数仍为 ${cellsAfterMulti}，实际 ${cells2}`)

fs.rmSync(TMP, { recursive: true, force: true })
console.log(fail ? `FAIL ${fail}` : 'PASS 皮层去重（upsert 幂等 + 加载自愈压缩）')
process.exit(fail ? 1 : 0)
