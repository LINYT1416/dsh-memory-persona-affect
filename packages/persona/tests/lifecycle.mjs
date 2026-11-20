// 10 轮全生命周期测试：用记忆插件 raw 里的真实对话喂六个器官。
// 每一轮都查，不是"有数据就算过"——数值必须在范围内、器官必须真的动了、快照必须来回一致。

import { readFile } from 'node:fs/promises'
import { createEngine } from '../core/engine.js'
import { describe } from '../core/desc.js'

const ROUNDS = JSON.parse(await readFile(new URL('./fixtures.json', import.meta.url), 'utf8'))

const UNIT = new Set([
  'primed', 'ritual', 'broken', 'stop', 'wanting', 'liking', 'compulsionGap', 'satiation',
  'conflict', 'error', 'adjusting', 'sticky', 'effort', 'surprise', 'monitor', 'socialClash',
  'commitment', 'pain', 'value', 'intent', 'warm', 'guilt', 'shame', 'unfair', 'risk',
  'expectGap', 'favors', 'taste', 'face', 'relevance', 'esteem', 'idealGap', 'discomfort',
  'boundary', 'protecting', 'calm', 'presentation', 'blameSelf', 'selfServing',
  'nostalgia', 'continuity', 'crisis', 'future', 'density', 'offense', 'air', 'misread',
  'empathy', 'ingroup', 'deception', 'blunt', 'belief',
])

// 有符号的量：本来就能是负的，别拿 0..1 去卡
const SIGNED = new Set(['expectGap'])

const seenCues = new Set()
const findings = []

function checkRange(reads) {
  const bad = []
  for (const [organ, obj] of Object.entries(reads)) {
    for (const [k, v] of Object.entries(obj || {})) {
      if (!UNIT.has(k)) continue
      if (typeof v !== 'number' || !Number.isFinite(v)) bad.push(`${organ}.${k}=不是数字`)
      else if (SIGNED.has(k)) { if (v < -1 || v > 1) bad.push(`${organ}.${k}=${v} 出界`) }
      else if (v < 0 || v > 1) bad.push(`${organ}.${k}=${v} 出界`)
    }
  }
  return bad
}

function fp(reads) {
  return JSON.stringify(Object.fromEntries(
    Object.entries(reads).map(([k, v]) => [k, Object.fromEntries(
      Object.entries(v).filter(([, x]) => typeof x === 'number').map(([a, b]) => [a, Math.round(b * 1000) / 1000]),
    )]),
  ))
}

const engine = createEngine()
let fails = 0

for (let i = 0; i < ROUNDS.length; i += 1) {
  const r = ROUNDS[i]
  const before = engine.health().ticks
  const traceBefore = engine.trace().length

  // 一轮 = 对方说一句 + 她回一句（回话走 role=assistant，测 A12 承诺一致）
  const f = engine.tick([{ type: 'user', text: r.text, at: Date.now() }], 'lifecycle')
  engine.tick([{ type: 'assistant', text: '嗯', at: Date.now() }], 'lifecycle')

  const reads = f.reads
  for (const cue of Object.keys((engine.organs.str.snapshot().habits) || {})) seenCues.add(cue)

  const problems = []

  // 1 器官有没有真跑
  if (engine.health().ticks - before !== 2) problems.push(`tick 没走完（+${engine.health().ticks - before}）`)
  // 2 有没有器官抛错
  if (engine.trace().length > traceBefore) problems.push(`器官报错：${JSON.stringify(engine.trace().slice(-1))}`)
  // 3 数值范围
  problems.push(...checkRange(reads))
  // 4 输出偏置范围
  if (!(f.hex.brevity >= 0 && f.hex.brevity <= 1)) problems.push('hex.brevity 出界')
  if (!(f.hex.delayMs >= 0 && f.hex.delayMs <= 360000)) problems.push('hex.delayMs 出界')
  // 5 traits 必须是平滑值，不是瞬时值
  const smoothOK = Math.abs(f.traits.esteem - (f.stable?.esteem?.mean ?? -1)) < 0.002
  if (!smoothOK) problems.push(`traits.esteem 没走平滑（${f.traits.esteem} vs ${f.stable?.esteem?.mean}）`)
  if (!f.rawTraits || typeof f.rawTraits.esteem !== 'number') problems.push('没有 rawTraits')
  // 6 注入文本
  const lines = describe(f, { max: 3 })
  if (!lines.length || lines.length > 4) problems.push(`注入行数异常 ${lines.length}`)
  if (lines.some((l) => /[0-9]/.test(l))) problems.push('注入里有数字')
  // 7 快照往返
  const snap = engine.snapshot()
  const clone = createEngine()
  clone.restore(JSON.parse(JSON.stringify(snap)))
  const again = clone.tick([{ type: 'user', text: r.text, at: Date.now() }], 'lifecycle')
  if (!again) problems.push('恢复后跑不动')
  else if (fp(again.reads) !== fp(engine.tick([{ type: 'user', text: r.text, at: Date.now() }], 'lifecycle').reads)) {
    problems.push('快照恢复后轨迹不一致')
  }
  // 8 签名强度必须在 [0,1]
  for (const s of engine.organs ? [] : []) void s
  const sig = engine.read()?.signatures || []
  for (const s of sig) if (s.strength < 0 || s.strength > 1) problems.push(`签名 ${s.id} 强度出界`)
  // 9 习惯只对见过的线索建
  const top = engine.read().reads.str.top
  for (const t of top) if (!seenCues.has(t.cue)) problems.push(`凭空长出习惯 ${t.cue}`)

  if (problems.length) {
    fails += problems.length
    findings.push({ round: i + 1, text: r.text.slice(0, 30), problems })
    console.log(`\n第 ${i + 1} 轮 ✗ ${problems.length} 处`)
    for (const p of problems) console.log(`   - ${p}`)
  } else {
    console.log(`第 ${i + 1} 轮 ✓  ${r.text.slice(0, 34)}`)
  }
}

// 幂等：同一句连发两次，习惯不该涨两次
const dup = createEngine()
dup.tick([{ type: 'user', text: '在吗', at: Date.now() }], 'dup')
const n1 = dup.organs.str.snapshot().habits.ping?.n || 0
dup.tick([{ type: 'user', text: '在吗', at: Date.now() }], 'dup')
const n2 = dup.organs.str.snapshot().habits.ping?.n || 0
console.log(`\n幂等：同一句连发两次，习惯次数 ${n1} -> ${n2}（应当只涨 1）`)
if (n2 - n1 !== 1) findings.push({ round: '幂等', text: '在吗', problems: [`连发两次涨了 ${n2 - n1} 次`] })

// 确定性：同一串话跑两遍，指纹必须一样
function runAll() {
  const e = createEngine()
  for (const r of ROUNDS) e.tick([{ type: 'user', text: r.text, at: 1_700_000_000_000 }], 'det')
  return fp(e.read().reads)
}
const a = runAll()
const b = runAll()
console.log(`确定性：${a === b ? '一致' : '不一致 ← 有问题'}`)
if (a !== b) findings.push({ round: '确定性', text: '重放', problems: ['两遍轨迹不同'] })

// ── 各司其职：每个器官只对自己的触发有反应 ──
console.log('\n各司其职（对照探针）：')
const PROBES = [
  { organ: 'ofc', field: 'shame', text: '随便你，你也就这样', want: 1, why: '冷话该让眶额羞' },
  { organ: 'mpfc', field: 'esteem', text: '你真厉害，我好喜欢你', want: 1, why: '夸该让自尊涨' },
  { organ: 'tpj', field: 'offense', text: '呵呵，就这？', want: 1, why: '阴阳该让颞顶觉得被冒犯' },
  { organ: 'str', field: 'stop', text: '在吗', want: 1, why: '连着来该让停止信号涨', mixed: true },
  { organ: 'acc', field: 'conflict', text: '随便你，你也就这样', want: 1, why: '冷话该起冲突' },
]
// 对照：四条形状都不一样的话（不同线索），避免"连着同类"这个因素混进来
const NEUTRAL = ['在吗', '我好累啊', '快一点', '哈哈哈']
for (const p of PROBES) {
  const a = createEngine()
  const b = createEngine()
  for (let i = 0; i < 4; i += 1) {
    a.tick([{ type: 'user', text: p.text, at: 1_700_000_000_000 + i }], 'probe')
    // 对照：用四条不同的话，避免"连着同类"这个因素混进来
    b.tick([{ type: 'user', text: p.mixed ? NEUTRAL[i] : '今天几点呢', at: 1_700_000_000_000 + i }], 'probe')
  }
  const va = a.read().reads[p.organ][p.field]
  const vb = b.read().reads[p.organ][p.field]
  const ok = p.want > 0 ? va > vb + 0.01 : va < vb - 0.01
  console.log(` ${ok ? '✓' : '✗'} ${p.organ}.${p.field}  ${va} vs 中性 ${vb}   (${p.why})`)
  if (!ok) findings.push({ round: '各司其职', text: p.text, problems: [`${p.organ}.${p.field} 没反应：${va} vs ${vb}`] })
}

// ── 注入会不会跟着状态变（同一个引擎连跑，模拟真实会话）──
const uniqueLines = new Set()
const seq = createEngine()
let prev = []
const allLines = []
for (const r of ROUNDS) {
  const f = seq.tick([{ type: 'user', text: r.text, at: 1_700_000_000_000 }], 'u')
  const lines = describe(f, { max: 3, prev })
  prev = lines
  allLines.push(lines.join(' / '))
  uniqueLines.add(allLines[allLines.length - 1])
}
console.log(`\n注入唯一性：10 轮里出现 ${uniqueLines.size} 种不同的话`)
for (const l of allLines) console.log(`   ${l}`)
if (uniqueLines.size < 3) findings.push({ round: '注入', text: '10 轮', problems: [`只有 ${uniqueLines.size} 种，注入不随状态变`] })

console.log(`\n合计问题 ${findings.length} 处`)
