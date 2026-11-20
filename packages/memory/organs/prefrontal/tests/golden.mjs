// golden set：50 组固定输入 → 输出快照。接器官前后 diff，必须逐条能解释。
// 第一次跑会自动建基线（这是唯一允许"自动写入"的测试）。
// 跑法：node tests/golden.mjs
import './env.mjs'
import { readFile, writeFile } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { goldenSets } from './fixtures.mjs'
import { plan } from '../kernel/plan.js'
import { judge } from '../kernel/judge.js'

const HERE = dirname(fileURLToPath(import.meta.url))
const BASELINE = join(HERE, 'golden.json')

const sets = goldenSets()

function digest(set) {
  const p = plan(set.query, { now: 1770000000000 })
  const r = judge(set.cands, {
    now: 1770000000000,
    session: `g${set.i % 3}`,
    plan: p,
    coverage: 0.5,
    turn: 1,
    openTasks: 1,
  })
  return {
    i: set.i,
    query: set.query,
    intent: p.intent,
    mode: p.mode,
    ids: r.verdicts.map((v) => v.id),
    conf: r.verdicts[0] ? Number(r.verdicts[0].confidence.toFixed(3)) : null,
    flags: r.flags,
    suppressed: r.suppressed.length,
  }
}

const current = sets.map(digest)

let baseline = null
try {
  baseline = JSON.parse(await readFile(BASELINE, 'utf8'))
} catch { /* 没有基线 */ }

if (!baseline) {
  await writeFile(BASELINE, JSON.stringify(current, null, 2), 'utf8')
  console.log(`\n前额叶 · golden set\n${'='.repeat(52)}`)
  console.log(`首次运行：已建基线 ${current.length} 组 → tests/golden.json`)
  console.log('以后每次接器官/改阈值都跑这个，diff 必须逐条能解释。')
  process.exit(0)
}

const diffs = []
for (let i = 0; i < Math.max(baseline.length, current.length); i += 1) {
  const a = baseline[i]
  const b = current[i]
  if (!a || !b) { diffs.push({ i, field: 'row', from: a, to: b }); continue }
  for (const field of ['intent', 'mode', 'ids', 'conf', 'flags', 'suppressed']) {
    if (JSON.stringify(a[field]) !== JSON.stringify(b[field])) {
      diffs.push({ i, query: a.query, field, from: a[field], to: b[field] })
    }
  }
}

console.log(`\n前额叶 · golden set\n${'='.repeat(52)}`)
console.log(`比对 ${current.length} 组`)

if (!diffs.length) {
  console.log('✓ 全部一致（0 diff）')
  process.exit(0)
}

console.log(`✗ ${diffs.length} 处不一致：\n`)
for (const d of diffs.slice(0, 30)) {
  console.log(`  [${d.i}] ${d.query} · ${d.field}`)
  console.log(`      旧 ${JSON.stringify(d.from)}`)
  console.log(`      新 ${JSON.stringify(d.to)}`)
}
console.log('\n规矩：diff 必须能逐条解释，解释不了不许合入。')
process.exit(1)
