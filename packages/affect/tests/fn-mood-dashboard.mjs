// 心情能不能从负面回来 + 仪表页读数是否真的随状态变。
//   node tests/fn-mood-dashboard.mjs
//
// 这条测试对着线上两个实测现象：
//   1) /affect/live 连着几天 headline 都是「心痛 / 委屈 / 闷闷的」，mood 卡在 -0.649；
//   2) 仪表页每天一样：只有一个负面词，社会层恒 0，别的器官常年不动。
//
// 断言（数字都会打出来）：
//   1) 连 10 轮负面后，3 轮正性输入让 mood 相对低谷抬 ≥0.15，且主情绪非负面；
//   2) 之后 3 小时无输入（模拟时钟），mood ≥ 基线 −0.05；
//   3) 30 轮混合对话里，正性情绪 ≥1 次，负性 ≤ 2/3；
//   4) 仪表页 organVoice 至少 4 个器官贡献非 0；headline 在 30 轮里 ≥3 个不同值；
//   5) 30 轮混合序列不存在"mood 单调下降"。
import { createEngine } from '../core/engine.js'
import { summarize, dashboardHtml, moodBand } from '../core/dashboard.js'
import { NEG_KINDS } from '../core/consts.js'

const POS_KINDS = new Set(['开心', '兴奋', '满足', '安心', '感动', '得意', '害羞', '心动', '想念'])
const fails = []
const ok = (c, m, d = '') => { if (!c) fails.push(`${m}${d ? `（${d}）` : ''}`) }

// fuse / inject 有几处"最近一拍"的全局状态：换场景先清掉，保证场景之间互不影响。
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
    at: () => t,
    go: (min) => { t += Math.round(min * 60_000) },
    say: (text) => e.tick([{ type: 'user', text, at: t }]),
  }
}

// ── 1 & 2：从低谷回来，以及 3 小时后回到底色 ───────────────────────
const NEG = [
  '你这做的什么垃圾，全是错的，重写',
  '又崩了，说了几遍还是这样',
  '行了别说了，烦死',
  '你怎么又忘了，第三次了',
  '我现在真的很失望',
  '算了我自己来吧',
  '这都做不好，要你干嘛',
  '烦不烦啊',
  '别再糊弄我了',
  '我真的受不了了',
]
const POS = [
  '你好棒啊，今天真的辛苦了',
  '谢谢你，这次很稳',
  '吃了家超好吃的面，今天真开心',
]

const w = mk('2026-11-19T10:00:00+08:00')
for (const text of NEG) { w.go(3); w.say(text) }
const trough = w.e.state.mood
const threatLow = w.e.organs.amygdala.read().threat
const posRows = []
for (const text of POS) {
  w.go(1)
  w.say(text)
  const f = w.e.read()
  posRows.push({
    text, mood: w.e.state.mood,
    emo: f.emotions?.[0]?.kind ?? '-',
    threat: w.e.organs.amygdala.read().threat,
  })
}
const afterPos = w.e.state.mood
const lift = afterPos - trough
const mainAfter = w.e.read().emotions?.[0]?.kind ?? null
console.log(`\n【1】10 轮负面 → 低谷 mood=${trough.toFixed(3)}（threat ${threatLow.toFixed(2)}）`)
for (const r of posRows) console.log(`     +「${r.text}」→ mood=${r.mood.toFixed(3)} 情绪=${r.emo} threat=${r.threat.toFixed(2)}`)
console.log(`     抬升 ${lift.toFixed(3)}，主情绪 ${mainAfter ?? '—'}`)
ok(lift >= 0.15, '正性输入应让 mood 相对低谷抬 ≥0.15', `实际 ${lift.toFixed(3)}`)
ok(mainAfter && !NEG_KINDS.has(mainAfter), '3 轮正性之后主情绪应变非负面', `实际 ${mainAfter}`)
ok(posRows[2].threat < threatLow - 0.02, '被善待之后威胁应当往下走（不是只改数字）',
  `${threatLow.toFixed(2)} → ${posRows[2].threat.toFixed(2)}`)

const base = w.e.persona.moodBase
const moodBeforeQuiet = w.e.state.mood
for (let i = 0; i < 6; i += 1) { w.go(30); w.e.tick([]) }   // 3 小时，每半小时一拍
const moodQuiet = w.e.state.mood
console.log(`【2】静默 3 小时（6 拍）：mood ${moodBeforeQuiet.toFixed(3)} → ${moodQuiet.toFixed(3)}；基线 ${base.toFixed(2)}`)
ok(moodQuiet >= base - 0.05, '静默 3 小时后 mood 应回到基线 −0.05 以上', `${moodQuiet.toFixed(3)} vs 下限 ${(base - 0.05).toFixed(3)}`)
ok(w.e.persona.tauMoodH >= 1 && w.e.persona.tauMoodH <= 8, '回底时间常数应是小时级（1~8 小时）', String(w.e.persona.tauMoodH))
ok(base >= 0, '底色不该是负值', String(base))

// ── 3/4/5：30 轮混合对话 ─────────────────────────────────────────
const MIXED = [
  '早呀，昨晚睡得挺舒服',
  '地铁上听到一首超好听的歌',
  '这个函数在 204 行',
  '老板说方案通过了，开心',
  '你太厉害了，谢谢你',
  '有点烦',
  '这个参数是多少',
  '算了，我自己来',
  '中午吃到一家超好吃的面',
  '下午的会改到三点了',
  '你怎么又忘了，第三次了',
  '对不起，我刚刚语气重了',
  '我把日志又看了一遍',
  '你今天真的辛苦了',
  '哼，不理你了',
  '晚上想吃什么',
  '刚跑完步，挺舒服的',
  '这个 bug 我搞定了，顺利',
  '你别总这样，行不行',
  '谢谢你陪我聊这么久',
  '我先去忙一会儿',
  '这个月第三次了',
  '晚上吃了火锅，好吃',
  '在吗',
  '你这做的什么垃圾，重写',
  '我知道你也不容易',
  '刚看到一只很可爱的猫，心情不错',
  '累死了，想睡了',
  '晚安，今天谢谢你',
  '明天还要早起，先睡了',
]

const m = mk('2026-11-19T09:00:00+08:00')
const rows = []
const voiceSeen = new Set()
const headlines = new Set()
for (let i = 0; i < MIXED.length; i += 1) {
  m.go(i % 5 === 4 ? 12 : 3)
  m.say(MIXED[i])
  const f = m.e.read()
  const d = summarize(m.e)
  const kind = f.emotions?.[0]?.kind ?? null
  headlines.add(d.headline)
  for (const v of d.organVoice) if (v.v > 0) voiceSeen.add(v.organ)
  rows.push({ i: i + 1, text: MIXED[i], mood: m.e.state.mood, kind, headline: d.headline, valence: f.valence })
}
const posCount = rows.filter((r) => r.kind && POS_KINDS.has(r.kind)).length
const negCount = rows.filter((r) => r.kind && NEG_KINDS.has(r.kind)).length
const noneCount = rows.filter((r) => !r.kind).length
console.log('\n【3/4】30 轮混合对话：')
for (const r of rows) {
  console.log(`  ${String(r.i).padStart(2)} ${r.mood.toFixed(3).padStart(7)} ${String(r.kind ?? '—').padEnd(4)} ${r.headline.padEnd(14)} ${r.text}`)
}
console.log(`  正性情绪 ${posCount} 次 / 负性 ${negCount} 次 / 无标签 ${noneCount} 次；不同 headline ${headlines.size} 个`)
console.log(`  有贡献的器官 ${voiceSeen.size} 个：${[...voiceSeen].join('、')}`)

ok(posCount >= 1, '30 轮混合里应至少出现 1 次正性情绪', String(posCount))
ok(negCount <= Math.floor(rows.length * 2 / 3), '负性情绪不该超过 2/3', `${negCount}/${rows.length}`)
ok(noneCount >= 1, '混合对话里应有无标签（中性）的拍', String(noneCount))
ok(posCount >= 3, '正性事件不该被吞掉（30 轮里至少 3 次）', String(posCount))
ok(headlines.size >= 3, 'headline 在 30 轮里应至少 3 个不同值', `${headlines.size}：${[...headlines].slice(0, 6).join(' / ')}`)
ok(voiceSeen.size >= 4, 'organVoice 至少 4 个器官有非 0 贡献', `${voiceSeen.size}`)

// 5) 不存在单调下降
const moods = rows.map((r) => r.mood)
let ups = 0
let run = 0
let maxRun = 0
for (let i = 1; i < moods.length; i += 1) {
  if (moods[i] > moods[i - 1] + 0.005) { ups += 1; run = 0 } else { run += 1; maxRun = Math.max(maxRun, run) }
}
const monotoneDown = ups === 0
console.log(`  mood 上行 ${ups} 次，最长连降 ${maxRun} 轮，区间 [${Math.min(...moods).toFixed(3)}, ${Math.max(...moods).toFixed(3)}]`)
ok(!monotoneDown, '30 轮序列不该是单调下降', `上行 ${ups} 次`)
ok(ups >= 3, '混合对话里 mood 应被抬起来过至少 3 次', `上行 ${ups} 次`)
ok(maxRun <= 12, '不该出现长时间连续下探', `最长连降 ${maxRun} 轮`)

// ── 6：仪表页的读数契约 ─────────────────────────────────────────
const d = summarize(m.e)
const dimFails = []
for (const x of d.dimensions) {
  if (!Number.isFinite(x.raw)) dimFails.push(`${x.key} raw 不是数`)
  if (!Array.isArray(x.range) || x.range.length !== 2) dimFails.push(`${x.key} 缺 range`)
  if (typeof x.source !== 'string' || !x.source) dimFails.push(`${x.key} 缺 source`)
  const [lo, hi] = x.range ?? [0, 1]
  const want = Math.round(((x.raw - lo) / (hi - lo)) * 100)
  if (Math.abs(want - x.v) > 1) dimFails.push(`${x.key} v=${x.v} 与 raw=${x.raw} 的区间 ${lo}~${hi} 不一致（应 ${want}）`)
  if (x.v < 0 || x.v > 100) dimFails.push(`${x.key} v 越界`)
}
ok(dimFails.length === 0, 'dimensions 的 v 必须能由 raw+range 还原', dimFails.slice(0, 4).join('；'))
ok(d.dimensions.length === 10, 'dimensions 应正好 10 个', String(d.dimensions.length))
for (const k of Object.keys(d.mind)) {
  const raw = d.mindRaw?.[k]
  if (!Number.isFinite(raw)) { ok(false, `mindRaw 缺 ${k}`); continue }
  ok(Math.abs(raw * 100 - d.mind[k]) <= 1, `mind.${k} 与 mindRaw 不一致`, `${d.mind[k]} vs ${raw}`)
  ok(typeof d.mindSource?.[k] === 'string', `mindSource 缺 ${k}`)
}
ok(d.organVoice.every((v) => Number.isFinite(v.v) && v.v >= 0 && v.v <= 100 && typeof v.text === 'string' && v.text.length > 0),
  'organVoice 每条都要有 0~100 的值和非空文字')
ok(d.organVoice.every((v) => Number.isFinite(v.contrib) && typeof v.source === 'string'),
  'organVoice 每条都要带原始贡献 contrib 和来源 source')
ok(d.mood.range?.[0] === -1 && d.mood.range?.[1] === 1 && d.mood.mid === 50, 'mood 要标出 -1..1 / 中点 50')
ok(d.headline.includes('｜') || !d.emotions.length, 'headline 应同时反映情绪与心情带', d.headline)

// moodBand 是纯函数：同一个 mood 永远同一档
ok(moodBand(0.8).tone === 'good' && moodBand(-0.8).tone === 'bad' && moodBand(0).tone === 'flat',
  'moodBand 分档方向不对', JSON.stringify([moodBand(0.8), moodBand(0), moodBand(-0.8)]))
ok(moodBand(-0.62).word !== moodBand(0.62).word, '极端心情不该用同一个词')

// HTML 能显示这些维度（器官贡献条 + 心情带）
const html = dashboardHtml()
ok(/voice/.test(html) && /track/.test(html), 'HTML 缺少器官贡献条')
ok(html.includes('心情带'), 'HTML 没显示心情带')
ok(!/https?:\/\//.test(html), 'HTML 不该引外网资源')

console.log('\n【6】仪表页契约：', JSON.stringify({
  headline: d.headline, band: d.mood.band, dims: d.dimensions.length,
  voice: d.organVoice.map((v) => `${v.organ}:${v.v}`).join(','),
}))

if (fails.length) {
  console.log(`\nFAIL ${fails.length}:`)
  for (const f of fails) console.log(' - ' + f)
  process.exit(1)
}
console.log('\nPASS 心情能回来（正性抬升 / 3 小时回底 / 标签多样 / 器官有声音 / 不单调下降）')
process.exit(0)
