// 杏仁核的门控口：relevance / tone / switches / goals。
//
// 这里最该证明的是"学过之后才提示"：
//   没学过 → caution 是 null（不硬给提示）
//   学过   → caution 给 subject + level，但 factor 仍然是 1（它不参与排序！）
//
//   node tests/amygdala-relevance-tone.mjs
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const root = mkdtempSync(join(tmpdir(), 'amyr-'))
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

// ── 没学过：不给提示，且明确说自己不是排序者 ───────────
const cold = amy.relevance({ subject: '中介' })
ok(cold?.factor === 1, `factor 该恒为 1（不参与排序），实际 ${cold?.factor}`)
ok(Array.isArray(cold?.why) && cold.why.includes('amygdala-not-a-reranker'),
  `没说清自己不是排序者：${JSON.stringify(cold?.why)}`)
ok(cold.caution === null, `没学过就该是 null，实际 ${JSON.stringify(cold.caution)}`)

const tone0 = amy.tone()
ok(Number.isFinite(Number(tone0?.ne)) && Number.isFinite(Number(tone0?.cort)),
  `tone 缺字段：${JSON.stringify(tone0)}`)

// ── 学一次：再问就要有提示，但依然不排序 ───────────────
await amy.observe({ text: '那个中介骗了我，我气死了', session: 's1', at: Date.now(), id: 'e1' })
await new Promise((r) => setTimeout(r, 60))

const hot = amy.relevance({ subject: '中介' })
ok(hot?.caution && typeof hot.caution === 'object', `学过之后该给提示：${JSON.stringify(hot?.caution)}`)
ok(String(hot.caution.subject) === '中介', `提示的主语不对：${hot.caution.subject}`)
ok(Number(hot.caution.level) > 0, `提示强度该 > 0，实际 ${hot.caution.level}`)
ok(hot.factor === 1, `学了东西也不该改排序权，实际 ${hot.factor}`)
ok(hot.caution.note && String(hot.caution.note).includes('不拦截'),
  `提示该说明自己不拦截：${hot.caution.note}`)

// ── tone：被戳到之后要动 ───────────────────────────────
const tone1 = amy.tone()
ok(Number(tone1.ne) > Number(tone0.ne), `负性经历之后 ne 该上升：${tone0.ne} → ${tone1.ne}`)

// ── 形状：switches 是对象、goals 是数组 ────────────────
ok(amy.switches && typeof amy.switches === 'object', `switches 不是对象：${typeof amy.switches}`)
ok(Array.isArray(amy.goals()), `goals 不是数组：${JSON.stringify(amy.goals())}`)

rmSync(root, { recursive: true, force: true })

if (fails.length) {
  console.log(`FAIL ${fails.length}:`)
  for (const f of fails) console.log(' - ' + f)
  process.exit(1)
}
console.log(`PASS 杏仁核门控（未学 null → 学过 ${hot.caution.subject} level ${hot.caution.level}；factor 恒 ${hot.factor}；tone ne ${Number(tone0.ne).toFixed(3)}→${Number(tone1.ne).toFixed(3)}）`)
process.exit(0)
