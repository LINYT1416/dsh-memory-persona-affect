// 人格的输出偏置与调制：hex / bias / modulate / retune。
//
// 这四项容易变成"返回一个好看的对象就算数"。这里钉的是：
//   · hex 五个字段都在、范围对（延迟必须 > 0；其余 0..1）
//   · bias 是 hex 的别名——现在就一样；哪天不一样，这个测试会说话
//   · modulate 要给四个器官各自的调节量，不是空对象
//   · retune 没事可做时必须明说理由，不许假装 ok:true
//
//   node tests/persona-hex-bias-modulate.mjs
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const root = mkdtempSync(join(tmpdir(), 'perhex-'))
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

const mod = await import('../index.js')
mod.apply(ctx)
await new Promise((r) => setTimeout(r, 300))
const per = services.get('memory.persona')

// 输出偏置要有东西可算，先走一拍
per.tick([{ type: 'user', text: '你行不行啊，这都做不好' }])
await new Promise((r) => setTimeout(r, 50))

// ── hex：五个字段，范围对 ──────────────────────────────
const hex = per.hex()
ok(hex && typeof hex === 'object', `hex 没返回对象：${JSON.stringify(hex)}`)
for (const k of ['brevity', 'warmth', 'meme', 'blunt']) {
  ok(Number.isFinite(Number(hex?.[k])), `hex.${k} 不是数字：${JSON.stringify(hex)}`)
  ok(Number(hex[k]) >= 0 && Number(hex[k]) <= 1, `hex.${k} 越界（0..1）：${hex[k]}`)
}
ok(Number(hex?.delayMs) > 0, `hex.delayMs 该 > 0，实际 ${hex?.delayMs}`)

// ── bias：现在就是 hex 的别名（钉住这个约定）──────────
const bias = per.bias()
ok(bias && typeof bias === 'object', `bias 没返回对象：${JSON.stringify(bias)}`)
ok(JSON.stringify(bias) === JSON.stringify(hex),
  `bias 跟 hex 不一致了（如果是有意分开，得改这个测试并说明）：\n  hex=${JSON.stringify(hex)}\n  bias=${JSON.stringify(bias)}`)

// ── modulate：四个器官各自的调节量 ───────────────────
const modu = per.modulate()
ok(modu && typeof modu === 'object', `modulate 没返回对象：${JSON.stringify(modu)}`)
const organs = Object.keys(modu || {})
ok(organs.length >= 3, `modulate 只调了 ${organs.length} 个器官：${organs.join(',')}`)
ok(Number.isFinite(Number(modu?.amygdala?.tauThreat)) && Number(modu.amygdala.tauThreat) > 0,
  `amygdala.tauThreat 不合理：${JSON.stringify(modu?.amygdala)}`)
ok(Number.isFinite(Number(modu?.pfc?.suppressionBase)) &&
  Number(modu.pfc.suppressionBase) >= 0 && Number(modu.pfc.suppressionBase) <= 1,
  `pfc.suppressionBase 越界：${JSON.stringify(modu?.pfc)}`)
ok(Number.isFinite(Number(modu?.persona?.threatGain)) && Number(modu.persona.threatGain) > 0,
  `persona.threatGain 不合理：${JSON.stringify(modu?.persona)}`)

// ── retune：没事可做时必须给理由 ──────────────────────
const retune = per.retune()
ok(retune && typeof retune === 'object', `retune 没返回对象：${JSON.stringify(retune)}`)
ok(typeof retune.ok === 'boolean', `retune 没给 ok：${JSON.stringify(retune)}`)
if (retune.ok === false) {
  ok(String(retune.reason || '').length > 0,
    `retune 说没做成却不说为什么：${JSON.stringify(retune)}`)
}

// ── 再走几拍：hex 还是合法值（别跑出范围）─────────────
for (let i = 0; i < 3; i++) per.tick([{ type: 'user', text: '谢谢你，今天挺开心的' + i }])
const hex2 = per.hex()
ok(Number(hex2?.delayMs) > 0, `多拍之后 delayMs 崩了：${hex2?.delayMs}`)
for (const k of ['brevity', 'warmth', 'meme', 'blunt']) {
  ok(Number(hex2?.[k]) >= 0 && Number(hex2[k]) <= 1, `多拍后 hex.${k} 越界：${hex2?.[k]}`)
}

rmSync(root, { recursive: true, force: true })

if (fails.length) {
  console.log(`FAIL ${fails.length}:`)
  for (const f of fails) console.log(' - ' + f)
  process.exit(1)
}
console.log(`PASS 人格偏置（hex 省略 ${hex.brevity} 暖 ${hex.warmth} 延迟 ${hex.delayMs}ms 表情包 ${hex.meme} 直 ${hex.blunt}；bias 与 hex 一致；modulate 调 ${organs.join('/')}；retune ${retune.ok ? 'ok' : '无改动:' + retune.reason}）`)
process.exit(0)
