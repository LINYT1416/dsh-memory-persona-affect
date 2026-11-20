// 器官契约验收：node verify.mjs <organ.mjs>
// 五个窗口交活前必须跑过这一关。全绿才算"能接总控"，不是"大概能跑"。

import { pathToFileURL } from 'node:url'
import { resolve } from 'node:path'
import { createHarness } from './mock-core.mjs'
import { CONTRACT_VERSION, makeTx, findNonFinite } from './contract.mjs'

let ORGAN = null
const file = process.argv[2]
if (!file) {
  console.error('用法: node verify.mjs <organ.mjs>')
  process.exit(2)
}

const results = []
const ok = (name, extra = '') => results.push({ name, pass: true, extra })
const bad = (name, extra = '') => results.push({ name, pass: false, extra })

const stable = (v) => JSON.stringify(v, (k, x) => (x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.keys(x).sort().map(i => [i, x[i]])) : x))

async function main() {
  let mod
  try {
    mod = await import(pathToFileURL(resolve(file)).href)
  } catch (e) {
    bad('import', e?.message || String(e))
    return
  }
  const organ = mod.organ || mod.default
  if (!organ) return bad('导出器官', '需要 export const organ = {...} 或 export default {...}')
  ORGAN = organ

  // 1. 契约形态
  const h = createHarness(organ)
  const v = h.validate()
  v.ok ? ok('契约形态 (id/contract/方法/params)') : bad('契约形态', v.errors.join('; '))

  // 2. init
  h.init()
  h.problems.length ? bad('init 不抛错', h.problems.join('; ')) : ok('init 不抛错')

  // 3. read 纯
  let r1, r2
  try {
    r1 = organ.read()
    r2 = organ.read()
    if (!r1 || typeof r1 !== 'object') bad('read() 返回对象')
    else if (stable(r1) !== stable(r2)) bad('read() 纯（两次调用不一致）')
    else ok('read() 纯')
  } catch (e) {
    bad('read() 不抛错', e?.message || String(e))
  }

  // 4. 常规心跳
  const before = h.problems.length
  h.runSteps(5, 60_000)
  h.problems.length === before ? ok('5 次心跳无异常') : bad('5 次心跳', h.problems.slice(before).join('; '))

  // 5. 巨大 dt（模拟关机 8 小时）
  const p2 = h.problems.length
  h.runTick({ t0: Date.now(), t1: Date.now() + 8 * 3600_000 })
  h.problems.length === p2 ? ok('dt=8h 不出非有限数') : bad('dt=8h', h.problems.slice(p2).join('; '))

  // 6. 幂等：同一个 txId 重放
  try {
    const tx = makeTx({ txId: 'tx_replay', t0: Date.now(), t1: Date.now() + 1000, seed: 1, events: [] })
    organ.onHeartbeat(tx, { rng: () => 0.5, emit: () => {} })
    const again = organ.onHeartbeat(tx, { rng: () => 0.5, emit: () => {} })
    const d = again?.delta ?? again ?? {}
    const flat = Object.values(d).filter(x => typeof x === 'number')
    const isNoop = again?.noop === true || (flat.length > 0 && flat.every(x => x === 0))
    isNoop ? ok('同一 txId 幂等') : bad('同一 txId 幂等', '第二次调用仍产生 delta，应按 txId 去重并返回 noop')
  } catch (e) {
    bad('同一 txId 幂等', e?.message || String(e))
  }

  // 7. snapshot / restore
  try {
    const snap = organ.snapshot()
    const before2 = stable(organ.read())
    organ.restore(JSON.parse(JSON.stringify(snap)))
    const after2 = stable(organ.read())
    before2 === after2 ? ok('snapshot→restore 可还原') : bad('snapshot→restore', '还原后状态不一致')
  } catch (e) {
    bad('snapshot/restore', e?.message || String(e))
  }

  // 8. health
  try {
    const hl = organ.health()
    const good = hl && typeof hl.ok === 'boolean' && typeof hl.degraded === 'boolean'
    good ? ok('health() 形状') : bad('health() 形状', '需要 { ok:boolean, degraded:boolean, ... }')
  } catch (e) {
    bad('health()', e?.message || String(e))
  }

  // 9. 未知信号
  try {
    organ.onSignal({ name: 'sig.不存在的信号', payload: {} }, { rng: () => 0.5 })
    ok('未知信号不抛错')
  } catch (e) {
    bad('未知信号不抛错', e?.message || String(e))
  }

  // 10. 状态里不许有 undefined / NaN
  try {
    const blob = { read: organ.read(), snap: organ.snapshot() }
    const nf = findNonFinite(blob)
    const hasUndef = JSON.stringify(blob).includes('undefined')
    nf.length || hasUndef ? bad('状态无 NaN/undefined', [...nf, hasUndef ? 'undefined' : ''].filter(Boolean).join(', ')) : ok('状态无 NaN/undefined')
  } catch (e) {
    bad('状态无 NaN/undefined', e?.message || String(e))
  }

  // 11. 发出的信号都已登记且载荷合法（由假总控收集）
  const sigProblems = h.problems.filter(p => p.includes('信号'))
  sigProblems.length ? bad('发出的信号合法', sigProblems.slice(0, 3).join('; ')) : ok('发出的信号合法')
}

await main()

const pad = Math.max(...results.map(r => r.name.length)) + 2
for (const r of results) {
  console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.name.padEnd(pad)}${r.extra ? '  ← ' + r.extra : ''}`)
}
const failed = results.filter(r => !r.pass)
console.log(`\n${results.length - failed.length}/${results.length} 通过  (契约 v${CONTRACT_VERSION}，器官 ${organ_id()})`)
process.exit(failed.length ? 1 : 0)

function organ_id() {
  return ORGAN?.id || 'unknown'
}
