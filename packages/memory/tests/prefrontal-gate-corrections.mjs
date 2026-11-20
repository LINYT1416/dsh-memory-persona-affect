// 前额叶闸门：把"别记"跟"别记错"分开。
//
// 以前一个裸的 /别记/ 就会整句拦掉，于是这种句子被丢掉：
//   「别记错了，我住威海不是烟台」  ← 这是**更正**，含真信息，最该记
// 反过来「这条别记」「别记我的手机号」是命令，必须拦。
//
// 这里钉的正是这一对方向：命令拦、更正放。
//
//   node tests/prefrontal-gate-corrections.mjs
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const root = mkdtempSync(join(tmpdir(), 'pfgate-'))
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

// ── 命令：必须拦 ─────────────────────────────────────
const block = ['别记我的手机号', '这条别记', '不要记下来', '别存这句']
for (const t of block) {
  const r = pfc.gate(t, 'user')
  ok(r.keep === false, `命令句该拦却放行了：${t} → ${JSON.stringify(r)}`)
  ok(r.depth === 0, `拦掉的深度该是 0：${t} → ${r.depth}`)
}

// ── 更正：必须放，而且要建索引 ────────────────────────
const keep = ['别记错了，我住威海不是烟台', '别记混了，是威海', '别记成烟台', '别的记不清了，好像是去年']
for (const t of keep) {
  const r = pfc.gate(t, 'user')
  ok(r.keep === true, `含真信息的更正被误杀：${t} → ${JSON.stringify(r)}`)
  ok(Number(r.depth) >= 1, `更正该至少落原文：${t} → ${r.depth}`)
}

// ── 噪声照旧拦，正常话照旧放 ─────────────────────────
ok(pfc.gate('嗯嗯', 'user').keep === false, '纯语气词该拦')
const normal = pfc.gate('我住威海，在机器人公司上班', 'user')
ok(normal.keep === true && Number(normal.depth) === 2,
  `正常事实该放行并建索引：${JSON.stringify(normal)}`)

rmSync(root, { recursive: true, force: true })

if (fails.length) {
  console.log(`FAIL ${fails.length}:`)
  for (const f of fails) console.log(' - ' + f)
  process.exit(1)
}
console.log(`PASS 闸门（命令 ${block.length} 条全拦；更正 ${keep.length} 条全放且 depth≥1；噪声拦、正常话 depth=2）`)
process.exit(0)
