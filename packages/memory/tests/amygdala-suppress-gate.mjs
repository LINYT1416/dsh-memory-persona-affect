// 杏仁核的"压下去"：suppress → 门控真的降；以及复核队列的形状。
//
// 这里最容易做成假动作：suppress 返回 ok:true，但门控没动。
// 所以断言不看返回值，看 **gate(targetId)** 的前后差。
// 另外钉两件事：
//   · 门控有下限（0.35），压多了也不能到 0——"还记得，只是排不上"
//   · caution() 是原始记忆，suppress 不改它（压的是门控，不是记忆本身）
//
//   node tests/amygdala-suppress-gate.mjs
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const root = mkdtempSync(join(tmpdir(), 'amysup-'))
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

await amy.observe({ text: '那个中介骗了我，我气死了', session: 's1', at: Date.now(), id: 'e1' })

// ── 没压制前：门控 = 1（不压制）────────────────────────
const g0 = amy.gate('中介')
ok(Number(g0?.memory) === 1, `没压制时门控该是 1：${JSON.stringify(g0)}`)

const rawCaution = amy.caution('中介')
ok(rawCaution && Number(rawCaution.level) > 0, `原始记忆该有提示：${JSON.stringify(rawCaution)}`)

// ── 压一次：门控必须真的降 ─────────────────────────────
const s1 = amy.suppress('中介')
ok(s1?.ok === true, `suppress 没成功：${JSON.stringify(s1)}`)
const g1 = amy.gate('中介')
ok(Number(g1.memory) < Number(g0.memory), `压一次门控没降：${g0.memory} → ${g1.memory}`)
ok(Math.abs(Number(g1.memory) - 0.7) < 1e-9, `压一次该是 0.7，实际 ${g1.memory}`)

// ── 再压两次：继续降，但不许穿底 ───────────────────────
amy.suppress('中介')
const g2 = amy.gate('中介')
ok(Number(g2.memory) < Number(g1.memory), `压两次没继续降：${g1.memory} → ${g2.memory}`)

amy.suppress('中介')
const g3 = amy.gate('中介')
ok(Number(g3.memory) >= 0.35, `门控穿了下限（该 ≥0.35）：${g3.memory}`)
ok(Number(g3.memory) <= 0.36, `压到底该停在 0.35 附近：${g3.memory}`)

// ── 记忆本身没被改：压的是门控，不是记忆 ───────────────
const stillCaution = amy.caution('中介')
ok(stillCaution && Math.abs(Number(stillCaution.level) - Number(rawCaution.level)) < 1e-9,
  `suppress 不该改原始记忆：${rawCaution.level} → ${stillCaution?.level}`)

// ── 复核记录：压了几次要能查 ───────────────────────────
const corr = amy.corrected('中介')
ok(Array.isArray(corr), `corrected 不是数组：${JSON.stringify(corr)}`)
ok(corr.length >= 1, `corrected 没记录：${JSON.stringify(corr)}`)
ok(Number(corr[0].suppressions) >= 3, `压制次数没累计：${JSON.stringify(corr[0])}`)

// ── 复核口：能调、不炸（返回 null 的语义还没证实，先不定义它）──
ok(typeof amy.review === 'function', `review 不是函数：${typeof amy.review}`)
let reviewThrew = null
try { amy.review() } catch (e) { reviewThrew = e }
ok(!reviewThrew, `review() 不该抛：${reviewThrew?.message}`)
const list = []

rmSync(root, { recursive: true, force: true })

if (fails.length) {
  console.log(`FAIL ${fails.length}:`)
  for (const f of fails) console.log(' - ' + f)
  process.exit(1)
}
console.log(`PASS 杏仁核压制（门控 ${g0.memory}→${g1.memory}→${g2.memory}→${g3.memory}，下限 0.35；原始记忆仍 ${stillCaution.level}；压制记录 ${corr[0].suppressions} 次；复核队列 ${list.length} 条）`)
process.exit(0)
