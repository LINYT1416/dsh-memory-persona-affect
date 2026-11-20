// 前额叶的核对口（verify）：海马补全完把候选推过来，这里判"能不能说、怎么说"。
//
// 本轮探测的结论（别重复踩）：
//   - coverage 只进排序分（judge.js:117），**不单独决定是否低置信**；
//   - 候选没有新鲜度/归档信息时会被打 cold 标记，置信度就上不去，
//     所以"给高 coverage 就该直说"这个假设是错的——这次断言的是自洽与排序。
//
//   node tests/prefrontal-verify.mjs
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const root = mkdtempSync(join(tmpdir(), 'verify-'))
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
const pfc = services.get('memory.prefrontal')

const now = Date.now()
const cands = [
  { id: 'a', text: '我下周去面试', at: now, score: 0.4 },
  { id: 'b', text: '我下周去面试，是机器人岗位', at: now, score: 0.5 },
]

const r = await pfc.verify(cands, { query: '面试', coverage: 0.5 })
ok(r?.ok === true, `verify 没返回 ok：${JSON.stringify(r)?.slice(0, 140)}`)

// ── 条数对得上：不许多也不许少 ─────────────────────────
const v = r.verdicts || []
ok(v.length === Number(r.kept), `verdicts(${v.length}) 应该等于 kept(${r.kept})`)
ok(v.length === cands.length, `两条候选应回两条裁决，实际 ${v.length}`)
ok(v.every((x) => Number.isFinite(Number(x.confidence))), `有裁决没给置信度：${JSON.stringify(v)}`)

// ── 排序单调：rankScore 不许逆序 ───────────────────────
ok(Number(v[0]?.rankScore) >= Number(v[1]?.rankScore),
  `排序分逆序了：${v[0]?.rankScore} 在 ${v[1]?.rankScore} 前面`)
ok(v[0]?.rank === 1, `第一条的 rank 该是 1，实际 ${v[0]?.rank}`)

// ── 约束和置信必须自洽：说不确定就不能同时允许直说 ─────
if (r.lowConfidence === true) {
  ok(r.constraint?.hedge === true, `低置信却没要求留余地：${JSON.stringify(r.constraint)}`)
  ok(typeof r.constraint?.note === 'string' && r.constraint.note.length > 0,
    '低置信该给一句说明，实际没有')
} else {
  ok(r.constraint?.hedge !== true, `不低置信却要求留余地：${JSON.stringify(r.constraint)}`)
}

// ── 空输入：不许炸 ─────────────────────────────────────
const empty = await pfc.verify([], { query: '面试', coverage: 0.5 })
ok(empty?.ok === true, `空候选该 ok，实际 ${JSON.stringify(empty)?.slice(0, 140)}`)
ok(Number(empty.kept) === 0, `空候选 kept 该是 0，实际 ${empty.kept}`)
ok((empty.verdicts || []).length === 0, `空候选不该有裁决，实际 ${(empty.verdicts || []).length} 条`)

rmSync(root, { recursive: true, force: true })

if (fails.length) {
  console.log(`FAIL ${fails.length}:`)
  for (const f of fails) console.log(' - ' + f)
  process.exit(1)
}
console.log(`PASS 前额叶核对（kept=${r.kept} 条裁决；排序 ${v[0]?.id}(${v[0]?.rankScore}) ≥ ${v[1]?.id}(${v[1]?.rankScore})；低置信=${r.lowConfidence} 与 hedge=${r.constraint?.hedge} 自洽；空输入 kept=0）`)
process.exit(0)
