// 冷却：被怼过之后多久缓过来，以及"记仇"有没有被抹掉。
//   node tests/fn-cooldown.mjs
//
// 这条测试对着线上实测：
//   tick 15469 → 15471（70 秒）：mood -0.649 → -0.640（只回升 0.009），
//   threat 100 → 97、frustration 0.998、rumination 高、sens{冷:1.3, 否定:1.55}。
//   也就是说：吵过一次之后威胁几乎不降，心情一直贴着地板，表现出来就是"天天都心痛"。
//
// 断言（数字都会打出来）：
//   1) 连续 3 轮重话 → threat ≥ 0.8；之后 30 分钟无输入（每分钟一拍）→ threat ≤ 0.4；
//      再 60 分钟 → threat ≤ 0.2；
//   2) 同一场景下 mood 从低谷到 ≥ 基线−0.1 的时间 ≤ 120 分钟；
//   3) 3 轮明确好话（"谢谢你，今天挺好"）能让 mood 从 ≤−0.4 抬到 ≥−0.1；
//   4) 连续 10 轮被骂后，长期项（关系账本 grudge / ledger）确实上升，
//      且 30 分钟安静之后它还在（记仇没被抹掉），可 threat 已经下来了；
//   5) organVoice 里贡献为 0 的器官，文案不得出现肯定句（拿 dashboard 输出断言）。
import { createEngine } from '../core/engine.js'
import { summarize } from '../core/dashboard.js'

const fails = []
const ok = (c, m, d = '') => { if (!c) fails.push(`${m}${d ? `（${d}）` : ''}`) }
const f = (n, k = 3) => Number(n).toFixed(k)

// fuse / inject 会留"最近一拍"的全局状态：每个场景先清掉，场景之间不互相污染。
const resetGlobals = () => {
  for (const k of ['__AFFECT_LAST_KIND__', '__AFFECT_LABEL_AGE__', '__AFFECT_APPRAISAL_HIST__',
    '__INJECT_PREVLINES__', '__INJECT_ROT__', '__INJECT_ROT2__', '__INJECT_LAST__']) {
    try { delete globalThis[k] } catch { /* ignore */ }
  }
}

const mk = (iso) => {
  resetGlobals()
  let t = new Date(iso).getTime()
  const e = createEngine({ now: () => t })
  return {
    e,
    now: () => t,
    go: (min) => { t += Math.round(min * 60_000) },
    say: (text) => e.tick([{ type: 'user', text, at: t }]),
    threat: () => e.organs.amygdala.read().threat,
    mood: () => e.state.mood,
    base: () => e.persona.moodBase,
  }
}

// 三句"重话"：一句字面难听、一句返工、一句冷。
const NEG3 = [
  '你这做的什么垃圾，全是错的，重写',
  '又崩了，说了几遍还是这样',
  '行了别说了，烦死',
]
const NEG10 = [
  ...NEG3,
  '你怎么又忘了，第三次了',
  '我现在真的很失望',
  '算了我自己来吧',
  '这都做不好，要你干嘛',
  '烦不烦啊',
  '别再糊弄我了',
  '我真的受不了了',
]
const POS3 = ['谢谢你，今天挺好', '谢谢你，这次很稳', '吃了家超好吃的面，今天真开心']

// ── 1：3 轮重话 → threat 顶上去；30 分钟 → ≤0.4；再 60 分钟 → ≤0.2 ─────────
const w = mk('2026-11-19T10:00:00+08:00')
const rise = []
for (const text of NEG3) {
  w.go(3)
  w.say(text)
  rise.push({ text, threat: w.threat(), mood: w.mood() })
}
const threatPeak = w.threat()
console.log('\n【1】三句重话：')
for (const r of rise) console.log(`  「${r.text}」→ threat=${f(r.threat)} mood=${f(r.mood)}`)
console.log(`  峰值 threat=${f(threatPeak, 3)}（阈值 0.8）`)
ok(threatPeak >= 0.8, '连续 3 轮重话之后 threat 应 ≥0.8', f(threatPeak))

const trail = []
let moodTrough = w.mood()
let t30 = null
let t90 = null
for (let m = 1; m <= 90; m += 1) {
  w.go(1)
  w.e.tick([])
  if (m === 30) t30 = w.threat()
  if (m === 90) t90 = w.threat()
  if ([10, 20, 30, 45, 60, 75, 90].includes(m)) trail.push({ m, threat: w.threat(), mood: w.mood() })
}
console.log('  无输入（每分钟一拍）：' + trail.map((r) => `${r.m}min threat=${f(r.threat)} mood=${f(r.mood)}`).join('；'))
console.log(`  30 分钟 threat=${f(t30)}（要求 ≤0.4）；90 分钟 threat=${f(t90)}（要求 ≤0.2）`)
ok(t30 <= 0.4, '安静 30 分钟后 threat 应 ≤0.4', f(t30))
ok(t90 <= 0.2, '安静 90 分钟（30+60）后 threat 应 ≤0.2', f(t90))
const base = w.base()
ok(base >= 0, '底色不该是负值', f(base))

// ── 2：同一场景下 mood 从低谷到 ≥ 基线−0.1 的时间 ≤ 120 分钟 ────────────────
// 重新跑一遍（上面那条已经把 90 分钟走完了），每分钟一拍记录 mood。
const w2 = mk('2026-11-19T10:00:00+08:00')
for (const text of NEG3) { w2.go(3); w2.say(text) }
moodTrough = w2.mood()
const target = w2.base() - 0.1
let recoverAt = null
const moodTrail = []
for (let m = 1; m <= 240; m += 1) {
  w2.go(1)
  w2.e.tick([])
  if ([5, 10, 20, 30, 60, 90, 120].includes(m)) moodTrail.push(`${m}min=${f(w2.mood())}`)
  if (recoverAt == null && w2.mood() >= target) recoverAt = m
}
console.log(`\n【2】低谷 mood=${f(moodTrough)}；基线 ${f(w2.base())}，目标 ≥ ${f(target)}`)
console.log(`  ${moodTrail.join(' ')}`)
console.log(`  回到目标用时：${recoverAt == null ? '240 分钟内没到' : `${recoverAt} 分钟`}`)
ok(moodTrough < base, '3 轮重话之后 mood 应低于基线', f(moodTrough))
ok(recoverAt != null && recoverAt <= 120, 'mood 应 ≤120 分钟回到 基线−0.1 以上', String(recoverAt))

// ── 3：3 轮好话，把 mood 从 ≤−0.4 抬到 ≥−0.1 ────────────────────────────────
const p = mk('2026-11-19T10:00:00+08:00')
for (const text of NEG10) { p.go(3); p.say(text) }
const deepTrough = p.mood()
const posRows = []
for (const text of POS3) {
  p.go(2)
  p.say(text)
  posRows.push({ text, mood: p.mood(), threat: p.threat() })
}
console.log(`\n【3】10 轮重话后 mood=${f(deepTrough)}（要求 ≤−0.4）`)
for (const r of posRows) console.log(`  +「${r.text}」→ mood=${f(r.mood)} threat=${f(r.threat)}`)
ok(deepTrough <= -0.4, '10 轮重话之后 mood 应 ≤−0.4（这条场景的前提）', f(deepTrough))
ok(posRows[posRows.length - 1].mood >= -0.1, '3 轮好话之后 mood 应 ≥−0.1', f(posRows[posRows.length - 1].mood))

// ── 4：10 轮被骂 → 长期项上升，且安静 30 分钟后还在 ───────────────────────────
const g = mk('2026-11-19T10:00:00+08:00')
g.go(3)
g.say(NEG10[0])
const grudgeAfter1 = g.e.grudge()
for (const text of NEG10.slice(1)) { g.go(3); g.say(text) }
const grudge10 = g.e.grudge()
const ledger10 = g.e.ledger()
const thrAfter10 = g.threat()
for (let m = 0; m < 30; m += 1) { g.go(1); g.e.tick([]) }
const grudgeQuiet = g.e.grudge()
const thrQuiet = g.threat()
console.log(`\n【4】1 轮 grudge=${f(grudgeAfter1, 4)} → 10 轮 grudge=${f(grudge10)}，账本 ${ledger10.length} 笔，threat=${f(thrAfter10)}`)
console.log(`  安静 30 分钟后：grudge=${f(grudgeQuiet, 4)}（要求仍在峰值 80% 以上）threat=${f(thrQuiet)}（要求 ≤0.4）`)
console.log(`  账本最近三笔：${ledger10.slice(-3).map((l) => `${l.kind}@${new Date(l.at).toLocaleTimeString('zh-CN')}`).join('；')}`)
ok(grudge10 >= 0.25, '10 轮被骂之后长期项 grudge 应明显上升', f(grudge10))
ok(grudge10 >= 3 * grudgeAfter1, '10 轮的长期项应远大于 1 轮（累积，不是一次性）', `${f(grudge10)} vs 3×${f(grudgeAfter1, 4)}`)
ok(ledger10.length >= 5, '关系账本应有实打实的笔数（≥5）', String(ledger10.length))
ok(grudgeQuiet >= grudge10 * 0.8, '30 分钟安静不该把长期项抹掉', `${f(grudgeQuiet, 4)} / ${f(grudge10, 4)}`)
ok(thrQuiet <= 0.4, '记仇留着，但即时威胁照样要下来', f(thrQuiet))
ok(g.e.organs.amygdala.read().threat <= 0.4, '器官读数与引擎一致', f(g.e.organs.amygdala.read().threat))

// ── 5：organVoice 里贡献为 0 的器官，文案不许是肯定句 ─────────────────────────
// 先跑一段中性对话，再拿 dashboard 的 summarize 输出逐条查。
const q = mk('2026-11-19T09:00:00+08:00')
const NEUTRAL = ['这个函数在 204 行', '日志我看了一遍，缓存没问题', '地铁上人好多', '这个参数是多少', '行，那我去忙一会儿']
for (const text of NEUTRAL) { q.go(4); q.say(text) }
const d = summarize(q.e)
const AFFIRM = /想起了|翻到旧事|也替他难受|被安抚到|绷着|提起来了|想要点什么|一点动静就惊|同时顾着|转不太动|有一点感觉/
const QUIET = new Set(['没感觉', '没被点着', '没插手', '没出声', '没翻到相似的', '翻到旧事，但没拽动', '没动静', '没调', '没动'])
const bad = []
const zero = []
for (const v of d.organVoice) {
  if (v.v !== 0) continue
  zero.push(`${v.organ}:${v.text}`)
  if (AFFIRM.test(String(v.text))) bad.push(`${v.organ}「${v.text}」贡献 0 却说肯定句`)
  if (!QUIET.has(String(v.text))) bad.push(`${v.organ}「${v.text}」不在"没出声"的话术表里`)
}
console.log(`\n【5】organVoice：${d.organVoice.map((v) => `${v.organ}:${v.v}${v.v === 0 ? `(${v.text})` : ''}`).join(' ')}`)
console.log(`  贡献为 0 的器官 ${zero.length} 个：${zero.join('、')}`)
ok(zero.length >= 1, '这段中性对话里应至少有一个器官贡献为 0（否则这条断言是空的）', String(zero.length))
ok(bad.length === 0, '贡献为 0 的器官不许说肯定句', bad.join('；'))

// 反例：回声明明翻到了（hits=1），但那条旧事不好不坏（tone=0），海马这一帧没拽动心情。
// 老代码只看 hits 非空就写"想起了旧事"，于是面板上出现"海马 0 分 + 想起了旧事"。
const bridge = {
  recallFast: () => ({ hits: [{ brief: '这做的什么垃圾，重写', valence: 0 }], tone: 0 }),
  fastStage: () => 'ok',
  salience: () => 0.5,
  noteText: () => {},
}
resetGlobals()
let t5 = new Date('2026-11-19T09:00:00+08:00').getTime()
const h = createEngine({ now: () => t5, bridge })
let hipZeroSaid = null
for (let i = 0; i < 4; i += 1) {
  t5 += 60_000
  h.tick([{ type: 'user', text: '这做的什么垃圾，重写', at: t5 }])
  const dd = summarize(h)
  const hv = dd.organVoice.find((x) => x.organ === '海马')
  const hits = h.read().memoryEcho?.hits?.length ?? 0
  if (hv && hv.v === 0 && hits > 0) { hipZeroSaid = { text: hv.text, hits }; break }
}
console.log(`  回声在但贡献为 0 的那一拍：${hipZeroSaid ? `海马「${hipZeroSaid.text}」（回声 ${hipZeroSaid.hits} 条）` : '没抓到'}`)
ok(hipZeroSaid != null, '应能构造出"回声在、海马贡献 0"的一拍（否则这条断言是空的）')
if (hipZeroSaid) {
  ok(!/想起了旧事/.test(hipZeroSaid.text), '回声还在、但海马贡献 0 时不许写"想起了旧事"', hipZeroSaid.text)
}

if (fails.length) {
  console.log(`\nFAIL ${fails.length}:`)
  for (const x of fails) console.log(' - ' + x)
  process.exit(1)
}
console.log('\nPASS 冷却（3 轮重话顶到 ≥0.8 / 30min ≤0.4 / 90min ≤0.2 / 120min 回到底色 / 好话能抬 / 记仇留着 / 0 值不说肯定句）')
process.exit(0)
