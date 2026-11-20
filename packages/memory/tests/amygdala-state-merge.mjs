// 线上现象：复核"挑中 50 条"，state.json 里 review 却是 0。
// 根因假设：同一数据目录有第二个写者，后写覆盖前写（不是没跑）。
// 这里模拟"外来的空 review 覆盖"，验证 saveState 会和磁盘并集合并，不丢队列。
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'amy-merge-'))
process.env.AMYGDALA_DIR = TMP

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
}

let fail = 0
const ok = (c, m, d = '') => { if (!c) { fail++; console.log('   FAIL', m, d) } else console.log('  ok:', m) }

const mod = await import('file:///E:/memory/dsh-all/organs/amygdala/index.js')
mod.apply(ctx)
await new Promise((r) => setTimeout(r, 500))
const A = svc['memory.amygdala']
ok(Boolean(A), '拿到 memory.amygdala')

for (let i = 0; i < 3; i += 1) A.bind({ id: `ep_merge_${i}`, score: 0.9, confidence: 0.9, source: { channel: 'test' } })
await new Promise((r) => setTimeout(r, 1000))

const r1 = await A.reviewSweep({ limit: 10 })
await new Promise((r) => setTimeout(r, 1000))
let st = JSON.parse(fs.readFileSync(path.join(TMP, 'state.json'), 'utf8'))
ok(r1.picked >= 3, '复核挑中 >=3 条', JSON.stringify(r1))
ok((st.review || []).length >= 3, '复核队列落盘 >=3', String((st.review || []).length))

// 模拟第二个写者：读到的是旧 state（没有 review），回写时把 review 抹掉
const foreign = { ...st }
delete foreign.review
delete foreign.reviewPool
fs.writeFileSync(path.join(TMP, 'state.json'), JSON.stringify(foreign), 'utf8')
ok(JSON.parse(fs.readFileSync(path.join(TMP, 'state.json'), 'utf8')).review === undefined, '外部写者已抹掉 review')

// 再触发一次本实例落盘：应该把磁盘上丢掉的并回来
A.bind({ id: 'ep_merge_after', score: 0.9, confidence: 0.9, source: { channel: 'test' } })
await new Promise((r) => setTimeout(r, 1200))
st = JSON.parse(fs.readFileSync(path.join(TMP, 'state.json'), 'utf8'))
ok((st.review || []).length >= 3, '被覆盖后仍能合并回来（review >=3）', String((st.review || []).length))
ok(Object.keys(st.reviewPool || {}).length >= 3, '复核池同样合并回来', String(Object.keys(st.reviewPool || {}).length))

fs.rmSync(TMP, { recursive: true, force: true })
console.log(fail ? `FAIL ${fail}` : 'PASS 状态合并（外来覆盖不丢复核队列）')
process.exit(fail ? 1 : 0)
