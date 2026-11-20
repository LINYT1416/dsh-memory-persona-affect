// 皮层的两个同步口：summarize（把命中的 cell 拼成一句）和 contradicts（两件事矛盾不矛盾）。
//
// 这里修过一个真冲突：contradicts 以前先问 judge，judge 因为两句只差一个手机号
// 判它们 same，于是"同主语同谓词不同值"这条永远走不到——两个手机号被报成"一致"，
// 而 upsert 那边明明记了冲突（同一系统两套说法，下游拿到的结论是反的）。
//
//   node tests/cortex-summarize-contradict.mjs
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const root = mkdtempSync(join(tmpdir(), 'cxs-'))
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

// 等装载完成再问：这几个同步口在 boot 之前会返回 why:'booting'（不是 bug，是降级）
await new Promise((r) => setTimeout(r, 500))

// ── 空输入：不编话 ─────────────────────────────────────
const empty = cx.summarize([])
ok(empty?.text === '', `空输入不该编出摘要：${JSON.stringify(empty)}`)
ok(Array.isArray(empty?.ids) && empty.ids.length === 0, `空输入 ids 该为空：${JSON.stringify(empty?.ids)}`)
ok(empty?.why === 'no-cells', `空输入该说明原因，实际 ${empty?.why}`)

// ── 灌两条事实 ─────────────────────────────────────────
cx.upsert([{ subject: '我', predicate: '手机号', object: '13800000001', supportIds: ['e1'] }])
cx.upsert([{ subject: '我', predicate: '手机号', object: '13800000002', supportIds: ['e2'] }])
await new Promise((r) => setTimeout(r, 250))

const hits = (await cx.search('手机号', { limit: 5 }))?.hits || []
ok(hits.length >= 2, `两条事实没都进库（${hits.length} 条）`)

// ── summarize：把命中的拼起来，并且带上 id ──────────────
const sum = cx.summarize(hits.map((h) => ({ id: h.cellId, text: h.text })))
ok(String(sum?.text).length > 0, `有内容却摘要为空：${JSON.stringify(sum)}`)
ok(String(sum.text).includes('13800000001') && String(sum.text).includes('13800000002'),
  `摘要没把两条都带上：${sum?.text}`)
ok(Array.isArray(sum?.ids) && sum.ids.length >= 1, `摘要没带 id：${JSON.stringify(sum?.ids)}`)
ok(sum.why === 'cortex-labels', `摘要该说明来源，实际 ${sum?.why}`)

// ── contradicts：同一个 cell 一致 ──────────────────────
const a = { subject: '我', predicate: '手机号', object: '13800000001', text: hits[0].text }
const b = { subject: '我', predicate: '手机号', object: '13800000002', text: hits[1].text }

const same = cx.contradicts(a, a)
ok(same?.verdict === 'consistent', `同一条该判一致，实际 ${JSON.stringify(same)}`)

// ── contradicts：不同值必须判矛盾（这次修的就是这条）──
const diff = cx.contradicts(a, b)
ok(diff?.verdict === 'contradict', `不同手机号该判矛盾，实际 ${JSON.stringify(diff)}`)
ok(diff?.why === 'same-subject-predicate-different-object', `矛盾原因不对：${diff?.why}`)
ok(Number(diff?.confidence) >= 0.5, `矛盾置信度太低：${diff?.confidence}`)

// ── 对不上号的一律说不知道，不硬判 ────────────────────
const unknown = cx.contradicts('不存在的id', '也不存在')
ok(unknown?.verdict === 'unknown', `找不到 cell 该说 unknown，实际 ${JSON.stringify(unknown)}`)

rmSync(root, { recursive: true, force: true })

if (fails.length) {
  console.log(`FAIL ${fails.length}:`)
  for (const f of fails) console.log(' - ' + f)
  process.exit(1)
}
console.log(`PASS 皮层摘要/矛盾（摘要「${sum.text}」；同 cell ${same.verdict}；不同值 ${diff.verdict}(${diff.why})；空输入 ${empty.why}）`)
process.exit(0)
