// 安全学习（消退）：说过"后来没事了"之后，再提到那个东西，警觉要真的降下来。
//
// 只验"接口返回 ok"不算——必须看到 caution 的 level 真的变小。
//
//   node tests/amygdala-safety.mjs
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const root = mkdtempSync(join(tmpdir(), 'safe-'))
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

// 先学一次恐惧
await amy.observe({ text: '那个中介骗了我三万块，我气死了', session: 's1', at: Date.now() })
const before = await amy.caution('中介')
ok(before && Number(before.level) > 0, `前置条件：没学到恐惧（${JSON.stringify(before)}）`)
const beforeLevel = Number(before?.level || 0)

// 再学"安全"：他退钱了
const s = await amy.safety('中介', { reason: '后来他退钱了' })
ok(s?.ok === true, `safety 没生效：${JSON.stringify(s)?.slice(0, 140)}`)

const after = await amy.caution('中介')
const afterLevel = Number(after?.level || 0)

ok(after === null || afterLevel < beforeLevel,
  `消退之后警觉没降：${beforeLevel} → ${afterLevel}`)

// 消退不能把记录抹掉（还能查到"这事有过安全记录"）
const safetyList = await amy.safety?.list?.() ?? null
if (safetyList) ok(JSON.stringify(safetyList).includes('中介'), '安全记录没落库')

rmSync(root, { recursive: true, force: true })

if (fails.length) {
  console.log(`FAIL ${fails.length}:`)
  for (const f of fails) console.log(' - ' + f)
  process.exit(1)
}
console.log(`PASS 安全消退（警觉 ${beforeLevel} → ${afterLevel}，降了 ${Math.round((beforeLevel - afterLevel) * 100)}%）`)
process.exit(0)
