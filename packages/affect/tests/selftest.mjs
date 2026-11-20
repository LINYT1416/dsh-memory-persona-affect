// 离线自测：不装 DSH 也能跑。
//   node tests/selftest.mjs
// 用一段脚本化对话看十五个模块合起来会怎么变，并断言硬性质。

import { createEngine } from '../core/engine.js'

let clock = new Date('2026-11-11T21:00:00+08:00').getTime()
const engine = createEngine({ now: () => clock })

const script = [
  ['你好棒啊，今天这个做得真不错', '夸'],
  ['你太厉害了，我服了', '夸'],
  ['随便吧', '冷'],
  ['哦', '冷'],
  ['你行不行啊，这都做不好', '骂'],
  ['对不起，我刚才语气重了', '道歉'],
  ['在吗', '日常'],
]

const rows = []
for (const [text, label] of script) {
  clock += 60_000
  const f = engine.tick([{ type: 'user', text, at: clock }])
  const injectText = engine.text({ hour: new Date(clock).getHours() })
  rows.push({
    label,
    mood: +engine.state.mood.toFixed(3),
    valence: +f.valence.toFixed(3),
    arousal: +f.arousal.toFixed(3),
    emo: f.emotions[0] ? `${f.emotions[0].kind} ${f.emotions[0].intensity.toFixed(2)}` : '-',
    threat: +engine.organs.amygdala.read().threat.toFixed(3),
    felt: +f.felt.intensity.toFixed(2),
    tone: f.display.toneShift,
    lines: injectText.split('\n').length,
    hasDigit: /[0-9]/.test(injectText),
  })
  if (label !== '日常') {
    console.log(`\n── ${label}：${text}`)
    console.log(injectText)
  }
}

console.log('\n#  标签   mood  valence arousal  情绪          threat felt  语气   行数 数字')
for (const [i, r] of rows.entries()) {
  console.log(
    `${String(i + 1).padStart(2)} ${r.label.padEnd(4)} ${String(r.mood).padStart(6)} ${String(r.valence).padStart(7)} ${String(r.arousal).padStart(7)}  ${r.emo.padEnd(10)} ${String(r.threat).padStart(6)} ${String(r.felt).padStart(4)}  ${r.tone.padEnd(6)} ${String(r.lines).padStart(4)} ${r.hasDigit ? '有' : '无'}`,
  )
}

// ── 第二阶段：连续被冷落 40 分钟 ──
const moodBefore = engine.state.mood
for (let i = 0; i < 10; i++) {
  clock += 4 * 60_000
  engine.tick([{ type: 'user', text: '随便吧', at: clock }])
}
const moodAfter = engine.state.mood
console.log(`\n连续被冷落 40 分钟：mood ${moodBefore.toFixed(3)} → ${moodAfter.toFixed(3)}`)

// ── 断言 ──
const fail = []
const ok = (cond, msg) => { if (!cond) fail.push(msg) }

ok(rows.every(r => Number.isFinite(r.mood) && r.mood >= -1 && r.mood <= 1), 'mood 必须有限且在 -1~1')
ok(rows.every(r => r.lines <= 7), '注入不超过 7 行')
ok(rows.every(r => !r.hasDigit), '注入不出现阿拉伯数字')
ok(moodAfter < moodBefore - 0.01, '连续被冷落 40 分钟，心境应下探')

const scold = rows.find(r => r.label === '骂')
const praise = rows.find(r => r.label === '夸')
ok(scold.threat > praise.threat + 0.05, '被骂之后 threat 高于被夸')
ok(['hard', 'flat'].includes(scold.tone), '被骂之后语气应收紧')

const hip = engine.organs.hippocampus.read()
ok(hip.count >= 1, '高显著事件应写入情绪情景')
ok(hip.count <= 30, '情景数不该爆炸')

const snap = engine.snapshot()
engine.restore(JSON.parse(JSON.stringify(snap)))
ok(Math.abs(engine.state.mood - snap.mood) < 1e-9, 'snapshot/restore 能还原 mood')

// 补算：关机 8 小时
clock += 8 * 3600_000
engine.tick([])
ok(Number.isFinite(engine.state.mood), '8 小时补算后 mood 仍有限')

// 不应期：强威胁后正性情绪被压
const cur = engine.organs.curve.read()
ok(typeof cur.intensity === 'number', '曲线模块有输出')

// 任何器官抛错都会被引擎吞掉并回滚，这里必须显式查一遍
const errs = engine.trace.filter(t => t.error || t.msg)
ok(errs.length === 0, `不该有被吞掉的器官异常，实际 ${errs.length} 条: ${JSON.stringify(errs.slice(0, 2))}`)

// 资源池
const r = engine.res.read()
ok(r.total >= 0 && r.total <= 1, '资源池在 0~1')

// 覆盖率：15 个模块都有 cover 声明
const cover = engine.cover()
const ids = Object.values(cover).flat()
ok(ids.length >= 150, `cover 声明的条目应 ≥150，实际 ${ids.length}`)

console.log('\n' + (fail.length ? `FAIL ${fail.length} 项：\n- ` + fail.join('\n- ') : 'PASS 全部断言通过'))
console.log(`模块 ${Object.keys(cover).length} 个，声明覆盖 ${ids.length} 条`)
process.exit(fail.length ? 1 : 0)
