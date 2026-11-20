// 前额叶给 delta、杏仁核执行（F15 的落点）：压得更狠 / 抬回来。
//
// 踩过的坑：服务层 adjust(id, { delta }) 收的是对象；
// 传裸数字会被 Number(undefined) 变 0，看起来"调了没反应"。
// 另外负数在 0 上会被下限钳住——想验证"抬回来"得先压下去。
//
//   node tests/amygdala-gate-adjust.mjs
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const root = mkdtempSync(join(tmpdir(), 'gadj-'))
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
const amy = services.get('memory.amygdala')

const ID = 'cue:中介'

// ── 压下去：正 delta → weightSum 升、gate 降 ─────────────
const a1 = await amy.adjust(ID, { delta: 0.2 })
ok(Number(a1?.weightSum) === 0.2, `第一次 +0.2 该是 0.2，实际 ${a1?.weightSum}`)
ok(Number(a1?.weight) < 1, `压下去之后 gate 该 < 1，实际 ${a1?.weight}`)

const a2 = await amy.adjust(ID, { delta: 0.2 })
ok(Number(a2?.weightSum) === 0.4, `累计该是 0.4，实际 ${a2?.weightSum}`)
ok(Number(a2?.weight) <= Number(a1?.weight), `压得更狠 gate 不该变大：${a1?.weight} → ${a2?.weight}`)

// ── 抬回来：负 delta → weightSum 回落 ───────────────────
const a3 = await amy.adjust(ID, { delta: -0.3 })
ok(Number(a3?.weightSum) < Number(a2?.weightSum), `负数该把抑制抬回来：${a2?.weightSum} → ${a3?.weightSum}`)
ok(Number(a3?.weight) >= Number(a2?.weight), `抬回来 gate 不该更小：${a2?.weight} → ${a3?.weight}`)

// ── 边界：夹在 0..0.95，不给负 ─────────────────────────
const a4 = await amy.adjust(ID, { delta: -5 })
ok(Number(a4?.weightSum) >= 0, `压过头下限该是 0，实际 ${a4?.weightSum}`)
const a5 = await amy.adjust(ID, { delta: 5 })
ok(Number(a5?.weightSum) <= 0.95, `上限该是 0.95，实际 ${a5?.weightSum}`)

// ── 空 id：不许炸，返回 gate 1 ─────────────────────────
const a6 = await amy.adjust('', { delta: 0.2 })
ok(a6 && Number(a6.weight) === 1, `空 id 该回 gate 1，实际 ${JSON.stringify(a6)}`)

rmSync(root, { recursive: true, force: true })

if (fails.length) {
  console.log(`FAIL ${fails.length}:`)
  for (const f of fails) console.log(' - ' + f)
  process.exit(1)
}
console.log(`PASS 门控调节（+0.2→${a1.weightSum} gate ${a1.weight}；+0.2→${a2.weightSum} gate ${a2.weight}；-0.3→${a3.weightSum} gate ${a3.weight}；上限 ${a5.weightSum}；空 id 不炸）`)
process.exit(0)
