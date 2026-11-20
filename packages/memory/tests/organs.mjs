// 杏仁核 + 前额叶的行为断言：情绪强度要真的推高显著性，噪声要真的被拦住。
//
// 起因：salience("你这个废物，滚吧") 和 salience("今天天气不错") 都是 0.3——
// 只有 reasons 多一行"对方像是angry"，分数一点没动。
// 因为情绪因子只取"说话人自己"的唤醒度，被骂时情绪在对方身上（parseOther）。
//
//   node tests/organs.mjs
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const root = mkdtempSync(join(tmpdir(), 'organs-'))
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
  get: (n) => (n === 'tools' ? ctx.tools : n === 'webServer' ? ctx.webServer : n === 'agents' ? ctx.agents : services.get(n) || null),
  on: () => () => {},
  emit: () => true,
  effect: () => () => {},
  logger: { info() {}, warn() {}, error() {} },
}

const { apply } = await import('../index.js')
apply(ctx)
const amy = services.get('memory.amygdala')
const pfc = services.get('memory.prefrontal')
ok(Boolean(amy), '没拿到 memory.amygdala')
ok(Boolean(pfc), '没拿到 memory.prefrontal')

// ── 1. 显著性要有方向：被骂 > 闲聊 ────────────────────────
const low = await amy.salience('今天天气不错')
const high = await amy.salience('你这个废物，滚吧，再也别来了')
ok(Number.isFinite(low?.score) && Number.isFinite(high?.score),
  `salience 分数不是数字：${JSON.stringify(low)?.slice(0, 120)}`)
ok(high.score > low.score + 0.05,
  `被骂的显著性该明显更高：high ${high?.score} vs low ${low?.score}`)
ok(high.modulators?.depth !== low.modulators?.depth || high.score > low.score,
  `显著性上来之后内存深度也该变：${high?.modulators?.depth} vs ${low?.modulators?.depth}`)
ok((high.components?.emotion || 0) > 0,
  `情绪分量该计入：${JSON.stringify(high.components)}`)

// ── 2. 前额叶闸门：噪声拦掉，真话留下 ─────────────────────
const noise = await pfc.gate('嗯')
const real = await pfc.gate('我已经决定辞职了，下周不去上班')
ok(noise?.keep === false, `"嗯"该被拦：${JSON.stringify(noise)}`)
ok(real?.keep === true, `真话该留下：${JSON.stringify(real)}`)
ok(Number(real?.depth) > Number(noise?.depth),
  `留下的深度该更高：real ${real?.depth} vs noise ${noise?.depth}`)

rmSync(root, { recursive: true, force: true })

if (fails.length) {
  console.log(`FAIL ${fails.length}:`)
  for (const f of fails) console.log(' - ' + f)
  process.exit(1)
}
console.log(`PASS 杏仁核+前额叶（被骂 ${high.score} vs 闲聊 ${low.score}；闸门噪声 ${noise.keep}/${noise.depth} 真话 ${real.keep}/${real.depth}）`)
process.exit(0)
