// 时间结构 / 注入约束 / 动力学不变量 / 跨表一致性 / 多器协作 的断言。
//   node tests/fn-time-inject-invariants.mjs
// 覆盖：W01–W10（表 13）、J01–J08（表 15）、K01–K12（表 16）、
//       C01–C10（表 17）、X01–X12（表 18），一条 ID 一条断言。
//
// 做法：能用真数据跑的就真跑（模块 step / 引擎 tick / 注入 render），
// 结构性不变量用静态扫描 + 行为探针（顺序探针、快照回放、快照篡改）。
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, dirname, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

import { createEngine } from '../core/engine.js'
import { render } from '../core/inject.js'
import { create as createCurve } from '../time/curve.js'
import { create as createRhythm } from '../time/rhythm.js'
import { create as createHippocampus } from '../organs/hippocampus.js'
import { create as createAmygdala } from '../organs/amygdala.js'
import { create as createInsula } from '../organs/insula.js'
import { create as createHypothalamus } from '../organs/hypothalamus.js'
import { create as createBrainstem } from '../supplements/brainstem.js'
import { createResources } from '../core/resource.js'
import { dayKey } from '../core/consts.js'
import { dashboardHtml } from '../core/dashboard.js'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const T0 = new Date('2026-11-12T20:00:00+08:00').getTime()

let pass = 0
let fail = 0
const ok = (id, msg = '') => { pass += 1; console.log(`ok: ${id}${msg ? ' ' + msg : ''}`) }
const bad = (id, msg = '') => { fail += 1; console.log(`FAIL ${id}${msg ? ' ' + msg : ''}`) }
const check = (id, cond, msg = '') => (cond ? ok(id, msg) : bad(id, msg))
const near = (a, b, eps = 1e-9) => Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) <= eps
const pct = (a, b) => `${(a * 100).toFixed(0)}%/${(b * 100).toFixed(0)}%`

// ───────────────────────── 小工具 ─────────────────────────

/** 直接驱动 time/curve.js 的假世界：只给曲线真正会读的三样东西 */
function curveWorld({ t1, intensity = 0, threat = 0, rumination = 0, emotions = [] }) {
  const vals = {
    insula: { felt: { intensity, qualities: [], location: '', precision: 0.5 } },
    amygdala: { threat },
    dmn: { rumination },
  }
  return { tx: { t1, t0: t1 - 60_000, dtMs: 60_000, events: [] }, get: (id) => vals[id] ?? null, emotions }
}

/** 直接驱动海马体的假世界（其余器官给最小可读快照） */
function hipWorld({ t1, dtMs = 60_000, events = [], amy = {}, ins = {}, hyp = {}, pfc = {}, nm = {}, emotions = [] }) {
  const vals = {
    amygdala: { threat: 0.1, rewardPE: 0, salience: 0.9, ...amy },
    insula: { felt: { intensity: 0.5, qualities: [], location: '', precision: 0.5 }, ...ins },
    hypothalamus: { hpa: { cortisol: 0.2 }, ...hyp },
    pfc: { bandwidth: 0.8, ...pfc },
    neuromod: { ach: 0.4, ...nm },
  }
  return {
    tx: { t1, t0: t1 - dtMs, dtMs, events }, get: (id) => vals[id] ?? null,
    mood: 0, scene: 'home', emotions,
  }
}

/** 直接驱动杏仁核的假世界 */
function amyWorld({ t1, dtMs = 60_000, events = [], prevGain = 0.5, sleepDebt = 0.2, pfc = null, scene = 'home' }) {
  const vals = {
    hypothalamus: { sleepDebt, hpa: { cortisol: 0.15 }, body: { hr: 70 } },
    pfc,
  }
  return { tx: { t1, t0: t1 - dtMs, dtMs, events }, get: (id) => vals[id] ?? null, prevGain, scene }
}

/** 直接驱动岛叶的假世界 */
function insulaWorld({ t1, dtMs = 60_000, events = [], body = {}, amy = { threat: 0, rewardPE: 0 }, gain = 1, onBody = 0.8, estrogen = 0.5, otherFelt = 0, similarity = 0.5 }) {
  const vals = {
    hypothalamus: {
      body: { hr: 70, hrv: 60, breath: 14, gut: 0, temp: 0, tension: 0.3, pain: 0.1, ...body },
      hpa: { cortisol: 0.2 }, needs: { hunger: 0.3, contact: 0.35 },
    },
    amygdala: { threat: 0, rewardPE: 0, novelty: 0, ...amy },
    attention: { onBody },
    neuromod: { gain },
    endocrine: { estrogen },
    social: { otherFelt, similarity },
  }
  return { tx: { t1, t0: t1 - dtMs, dtMs, events }, get: (id) => vals[id] ?? null, memoryEcho: null }
}

/** 一个能真跑引擎的时钟 */
function clocked(t0 = T0) {
  let t = t0
  const e = createEngine({ now: () => t })
  return { e, get: () => t, advance(ms) { t += ms; return t }, set(v) { t = v } }
}

/** 把每个器官的 step / fast 调用按顺序记下来（多器协作的顺序探针） */
function captureOrder(e) {
  const order = []
  for (const [id, m] of Object.entries(e.organs)) {
    if (!m || typeof m.step !== 'function') continue
    const step = m.step.bind(m)
    m.step = (w) => { order.push(id); return step(w) }
    if (typeof m.fast === 'function') {
      const fast = m.fast.bind(m)
      m.fast = (w) => { order.push(`${id}.fast`); return fast(w) }
    }
  }
  return order
}

const idx = (arr, id) => arr.indexOf(id)

/** 一轮注入的最小 fused 形状（只给 render 真会读的字段） */
function fusedOf(o = {}) {
  const base = {
    emotions: [], mood: 0,
    felt: { intensity: 0, qualities: [], location: '', precision: 0.5 },
    display: { toneShift: 'normal', brevity: 0.3, leakRisk: 0.1, mask: 0.3 },
    recall: null, arousal: 0.3,
    attribution: { locus: 'circumstance', confidence: 0.5 },
    io: { brevity: 0.3, punctuation: 'normal', replyDelayMs: 0, venting: 0, memeTendency: 0.5, meme: null },
    needs: {}, energy: 0.6, signals: {},
    socialPain: 0, repair: 0, seekComfort: 0, startle: 0, withdraw: 0,
    idle: 0, socialImagining: 0, nostalgia: 0, meme: null, memoryEcho: null,
  }
  return { ...base, ...o }
}

/** 注入文本的行级相似度：相同行 / 较长那份的行数（"这一轮有多少是一样的"） */
function lineSimilarity(a, b) {
  const A = a.split('\n').filter(Boolean)
  const B = b.split('\n').filter(Boolean)
  if (!A.length || !B.length) return 1
  const setB = new Set(B)
  const common = A.filter((l) => setB.has(l)).length
  return common / Math.max(A.length, B.length)
}

// ───────────────────────── 静态扫描工具 ─────────────────────────

function walkJs(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === 'tests' || name.startsWith('.')) continue
    const p = join(dir, name)
    const st = statSync(p)
    if (st.isDirectory()) walkJs(p, out)
    else if (name.endsWith('.js')) out.push(p)
  }
  return out
}

/** 去掉注释和字符串/模板字面量，只留可执行代码（浏览器面板的 HTML 也算字符串） */
function stripNonCode(src) {
  let out = ''
  let i = 0
  const n = src.length
  while (i < n) {
    const c = src[i]
    const d = src[i + 1]
    if (c === '/' && d === '/') { while (i < n && src[i] !== '\n') i += 1; continue }
    if (c === '/' && d === '*') {
      i += 2
      while (i < n && !(src[i] === '*' && src[i + 1] === '/')) i += 1
      i += 2
      continue
    }
    if (c === '"' || c === "'" || c === '`') {
      const q = c
      i += 1
      while (i < n) {
        if (src[i] === '\\') { i += 2; continue }
        if (src[i] === q) { i += 1; break }
        i += 1
      }
      out += ' "" '
      continue
    }
    out += c
    i += 1
  }
  return out
}

const JS_FILES = walkJs(ROOT)
const relOf = (p) => relative(ROOT, p).replace(/\\/g, '/')
const CODE = new Map(JS_FILES.map((p) => [p, stripNonCode(readFileSync(p, 'utf8'))]))

// ═════════════════════════ 表 13 · 时间结构 W01–W10 ═════════════════════════

// W01 五段曲线：有平台期，非纯指数
{
  const curve = createCurve()
  const t0 = T0
  const samples = []
  // 用中等强度（0.35 < 二次高峰门槛 0.4）：先单独量五段的形状，别把 W02 的回潮混进来
  for (let s = 0; s <= 11_520; s += 15) {
    curve.step(curveWorld({ t1: t0 + s * 1000, intensity: 0.35 }))
    const r = curve.read()
    samples.push({ age: s, phase: r.phase, v: r.intensity })
  }
  const phases = [...new Set(samples.map((x) => x.phase))]
  const order = ['attack', 'peak', 'plateau', 'decay', 'residual']
  const ordered = phases.every((p, i) => i === 0 || order.indexOf(p) > order.indexOf(phases[i - 1]))
  const plateau = samples.filter((x) => x.phase === 'plateau')
  const pMax = Math.max(...plateau.map((x) => x.v))
  const pMin = Math.min(...plateau.map((x) => x.v))
  const plateauFlat = (pMax - pMin) / pMax < 0.1
  const peakV = Math.max(...samples.map((x) => x.v))
  const decay = samples.filter((x) => x.phase === 'decay')
  const dMax = Math.max(...decay.map((x) => x.v))
  const dMin = Math.min(...decay.map((x) => x.v))
  const decayDrops = (dMax - dMin) / dMax > 0.6
  const residual = samples.filter((x) => x.phase === 'residual')
  const residualLow = residual.length > 0 && Math.max(...residual.map((x) => x.v)) < 0.25
  // 平台期是平的：同一段时间如果按纯指数衰减，早就掉了一半以上
  const pureExpAtPlateauEnd = peakV * Math.exp(-(1_200_000 - 180_000) / (90 * 60_000))
  const notPureExp = pMin > pureExpAtPlateauEnd
  check('W01', ordered && plateauFlat && decayDrops && residualLow && notPureExp,
    `五段 ${phases.join('→')}；平台 ${pMin.toFixed(2)}~${pMax.toFixed(2)}（纯指数会到 ${pureExpAtPlateauEnd.toFixed(2)}）；衰减掉 ${((1 - dMin / dMax) * 100).toFixed(0)}%；残留 ${residual.length ? Math.max(...residual.map((x) => x.v)).toFixed(2) : '-'}`)
}

// W02 二次高峰：30 分钟内第二峰，且一股情绪只拱一次
{
  const curve = createCurve()
  const t0 = T0
  const fires = []
  let bump = 0
  let prev = 0.1
  for (let s = 0; s <= 1900; s += 20) {
    curve.step(curveWorld({
      t1: t0 + s * 1000, intensity: 0.85,
      threat: s < 60 ? 0.9 : 0.05,      // 被扎一下之后威胁就退了，只剩余温
      rumination: 0.5,
    }))
    const snap = curve.snapshot()
    if (snap.secondPeakAt && !fires.includes(snap.secondPeakAt)) {
      fires.push(snap.secondPeakAt)
      bump = curve.read().intensity - prev
    }
    prev = curve.read().intensity
  }
  const ageMin = fires.length ? (fires[0] - t0) / 60_000 : -1
  const within30 = fires.length === 1 && ageMin > 5 && ageMin <= 30
  const bumpUp = bump > 0.05
  // 回潮只在这 10 分钟窗口里对外可见；31 分钟后不该还挂着
  const later = (() => {
    const c = createCurve()
    c.step(curveWorld({ t1: t0, intensity: 0.85, threat: 0.9, rumination: 0.5 }))
    for (let s = 20; s <= 1900; s += 20) c.step(curveWorld({ t1: t0 + s * 1000, intensity: 0.85, threat: 0.05, rumination: 0.5 }))
    return c.read().secondPeak
  })()
  check('W02', within30 && bumpUp && later === 0,
    `第 ${ageMin.toFixed(1)} 分钟冒了一次（抬 ${bump.toFixed(2)}），31 分钟后 secondPeak=${later}`)
}

// W03 隔夜再加工：睡后强度降 ≥15%
{
  const hip = createHippocampus()
  const night = new Date('2026-11-12T20:30:00+08:00').getTime()
  const ep = {
    id: 'ep_w03', at: night, day: dayKey(night), cue: '冷', triggerBrief: '被冷淡地顶了一下',
    kind: '委屈', target: '他', valence: -0.4, intensity: 0.6, salience: 0.8,
    scene: 'home', recalls: 0, reconsolidations: 0, distortion: 0,
  }
  hip.restore({ episodes: [ep], pending: [], schemas: [], persons: {}, lastRecall: null, encodes: 1, overnightAt: '', reactivate: 0, frame: 0 })
  // 同一天晚上：不做隔夜加工
  hip.step(hipWorld({ t1: new Date('2026-11-12T22:30:00+08:00').getTime() }))
  const sameNight = hip.snapshot().episodes[0].intensity
  // 第二天凌晨三点后：降 20%
  hip.step(hipWorld({ t1: new Date('2026-11-13T03:10:00+08:00').getTime() }))
  const afterNight = hip.snapshot().episodes[0].intensity
  // 白天：不再重复降（分时段，C03 的另一半）
  hip.step(hipWorld({ t1: new Date('2026-11-13T14:00:00+08:00').getTime() }))
  const afterDay = hip.snapshot().episodes[0].intensity
  const drop = sameNight > 0 ? 1 - afterNight / sameNight : 0
  check('W03', drop >= 0.15 && near(afterDay, afterNight, 1e-9) && afterNight < sameNight,
    `同晚不变 ${sameNight.toFixed(2)} → 隔夜 ${afterNight.toFixed(2)}（降 ${(drop * 100).toFixed(0)}%）→ 白天不再降 ${afterDay.toFixed(2)}`)
}

// W04 周节律：周一低于周五
{
  const rhythm = createRhythm()
  const mon = new Date('2026-11-16T10:00:00+08:00').getTime()   // 周一
  const fri = new Date('2026-11-20T10:00:00+08:00').getTime()   // 周五
  rhythm.step({ tx: { t1: mon, t0: mon, dtMs: 0, events: [] }, mood: 0 })
  const wMon = rhythm.read().weekly
  rhythm.step({ tx: { t1: fri, t0: fri, dtMs: 0, events: [] }, mood: 0 })
  const wFri = rhythm.read().weekly
  // 同一天之内也有很轻的起伏（不是一个死值）
  const monMorning = (() => {
    const r = createRhythm()
    r.step({ tx: { t1: new Date('2026-11-16T05:00:00+08:00').getTime(), t0: 0, dtMs: 0, events: [] }, mood: 0 })
    return r.read().weekly
  })()
  check('W04', wMon < wFri && Math.abs(wMon - wFri) > 0.1 && Math.abs(monMorning - wMon) > 0.005,
    `周一 ${wMon.toFixed(3)} < 周五 ${wFri.toFixed(3)}；周一早/午 ${monMorning.toFixed(3)}/${wMon.toFixed(3)}`)
}

// W05 季节/光照：只做日长，幅度 ±0.05
{
  const rhythm = createRhythm()
  const at = (iso) => {
    const t = new Date(iso).getTime()
    rhythm.step({ tx: { t1: t, t0: t, dtMs: 0, events: [] }, mood: 0 })
    return rhythm.read().seasonal
  }
  const summer = at('2026-06-21T12:00:00+08:00')
  const winter = at('2026-12-21T12:00:00+08:00')
  let peak = 0
  for (let d = 0; d < 365; d += 7) {
    const t = new Date('2026-01-01T12:00:00+08:00').getTime() + d * 86_400_000
    rhythm.step({ tx: { t1: t, t0: t, dtMs: 0, events: [] }, mood: 0 })
    peak = Math.max(peak, Math.abs(rhythm.read().seasonal))
  }
  check('W05', summer > 0 && winter < 0 && peak <= 0.0501,
    `夏至 ${summer.toFixed(3)} > 冬至 ${winter.toFixed(3)}；全年峰值 ${peak.toFixed(3)} ≤ 0.05`)
}

// W06 长期人格漂移：30 天基线 ±0.1
{
  const run = (mood) => {
    const rhythm = createRhythm()
    let t = new Date('2026-11-01T00:00:00+08:00').getTime()
    rhythm.step({ tx: { t1: t, t0: t, dtMs: 0, events: [] }, mood })
    let day1 = null
    for (let h = 1; h <= 720; h += 1) {
      t += 3_600_000
      rhythm.step({ tx: { t1: t, t0: t - 3_600_000, dtMs: 3_600_000, events: [] }, mood })
      if (h === 24) day1 = rhythm.read().drift
    }
    return { day1, final: rhythm.read().drift }
  }
  const up = run(0.1)
  const down = run(-0.1)
  const strong = run(0.6)
  const flat = run(0)
  const bounded = Math.abs(up.final) <= 0.1001 && Math.abs(down.final) <= 0.1001 && Math.abs(strong.final) <= 0.1001
  const reaches = Math.abs(up.final) >= 0.09 && Math.abs(down.final) >= 0.09
  const gradual = Math.abs(up.day1) < Math.abs(up.final) && Math.abs(down.day1) < Math.abs(down.final)
  check('W06', bounded && reaches && gradual && Math.abs(flat.final) < 0.02,
    `30 天：正向 ${up.final.toFixed(3)}（第 1 天 ${up.day1.toFixed(3)}）、负向 ${down.final.toFixed(3)}；强底色也只到 ${strong.final.toFixed(3)}（±0.1 封顶）`)
}

// W07 情绪惯性：激动时难转平静，单拍变化有上限
{
  const curve = createCurve()
  const t0 = T0
  for (let s = 0; s <= 180; s += 30) curve.step(curveWorld({ t1: t0 + s * 1000, intensity: 0.9 }))
  const high = curve.read().intensity
  curve.step(curveWorld({ t1: t0 + 210_000, intensity: 0.05 }))
  const after = curve.read().intensity
  const drop = high - after
  check('W07', drop <= 0.2501 && drop >= 0.2 && after > 0.55,
    `${high.toFixed(2)} → 一分钟内只降到 ${after.toFixed(2)}（降 ${drop.toFixed(2)}，不是直接归零）`)
}

// W08 不应期：生气后 10 分钟哄不动
{
  const curve = createCurve()
  const t0 = T0
  curve.step(curveWorld({ t1: t0, intensity: 0.5, threat: 0.9 }))
  const at = (min) => {
    curve.step(curveWorld({ t1: t0 + min * 60_000, intensity: 0.4, threat: 0.05 }))
    return curve.read().refractory
  }
  const r0 = curve.read().refractory
  const r5 = at(5)
  const r9 = at(9)
  const r10 = at(10.1)
  // 真跑一个引擎：不应期里 coping 被压住，注入也会说"哄不动"
  const drive = (force) => {
    const { e, advance } = clocked()
    if (force) {
      const cur = e.organs.curve
      const orig = cur.read.bind(cur)
      cur.read = () => ({ ...orig(), refractory: true })
    }
    advance(60_000)
    e.tick([{ type: 'user', text: '对不起，我不该那么说', at: T0 + 60_000 }])
    return e.read()
  }
  const calm = drive(false)
  const hard = drive(true)
  const copingDrop = calm.appraisal.coping - hard.appraisal.coping
  const canSay = (() => {
    for (let k = 0; k < 40; k += 1) if (render(hard, { tick: k }).includes('哄不动')) return true
    return false
  })()
  check('W08', r0 && r5 && r9 && !r10 && copingDrop >= 0.08 && canSay,
    `0/5/9 分钟仍哄不动，10.1 分钟解除；应期 coping −${copingDrop.toFixed(2)}，注入能说"哄不动"`)
}

// W09 强度-时长权衡：高强度半衰短
{
  const halfLife = (start) => {
    const curve = createCurve()
    const t0 = T0
    let hit = null
    for (let m = 0; m <= 400; m += 1) {
      curve.step(curveWorld({ t1: t0 + m * 60_000, intensity: start }))
      const v = curve.read().intensity
      if (m >= 20 && hit === null && v <= start * 0.5) hit = m
    }
    return hit
  }
  const high = halfLife(0.9)
  const mid = halfLife(0.55)
  const low = halfLife(0.3)
  check('W09', high !== null && mid !== null && low !== null && high < mid && mid < low && mid - high >= 20,
    `半衰：强 ${high} 分 < 中 ${mid} 分 < 弱 ${low} 分`)
}

// W10 矛盾情绪：两股同时 >0.4
{
  const curve = createCurve()
  const step = (emotions) => {
    curve.step(curveWorld({ t1: T0, intensity: 0.3, emotions }))
    return curve.read().ambivalence
  }
  const two = step([{ kind: '生气', intensity: 0.62 }, { kind: '委屈', intensity: 0.51 }])
  const one = step([{ kind: '生气', intensity: 0.62 }, { kind: '委屈', intensity: 0.39 }])
  const none = step([{ kind: '生气', intensity: 0.2 }])
  const says = (() => {
    const f = fusedOf({ emotions: [{ kind: '生气', intensity: 0.6 }, { kind: '委屈', intensity: 0.5 }], mood: -0.3, signals: { ambivalence: 1 } })
    for (let k = 0; k < 20; k += 1) if (render(f, { tick: k }).includes('两股劲儿在打架')) return true
    return false
  })()
  check('W10', two === 1 && one === 0 && none === 0 && says,
    `两股>0.4→${two}，一股>0.4一股<0.4→${one}，都不到→${none}；注入能说"两股劲儿在打架"`)
}

// ═════════════════════════ 表 15 · 注入与产品约束 J01–J08 ═════════════════════════

// 真跑一段对话，拿到真实的 fused 与注入
const J_SCRIPT = [
  '你行不行啊，说了几遍还是崩', '算了，我自己来', '谢谢你，这次真的稳', '在忙吗',
  '今天天气不错', '我有点难过', '抱一下', '快点，来不及了', '哈哈哈哈哈',
  '我不想聊了', '帮我看下这个报错', '晚安', '你是不是傻', '辛苦了',
  '再改一版', '我信你', '别闹', '这个月第三次了', '吃了吗', '我想你了',
]
const J_RUNS = (() => {
  const { e, advance } = clocked()
  const runs = []
  for (const text of J_SCRIPT) {
    advance(3 * 60_000)
    e.tick([{ type: 'user', text, at: e.state.at + 3 * 60_000 }])
    runs.push({ fused: e.read(), hour: 21 })
  }
  return runs
})()

const J_TEXTS = (() => {
  const out = []
  for (const r of J_RUNS) for (let k = 0; k < 8; k += 1) out.push({ text: render(r.fused, { hour: r.hour, tick: k }), fused: r.fused })
  // 冷状态、缺器官、带脏动态摘要的极端样本
  const cold = fusedOf({
    mood: -0.7, emotions: [{ kind: '生气', intensity: 0.9 }],
    felt: { intensity: 0.7, qualities: ['紧', '堵'], location: '胸口', precision: 0.8 },
    display: { toneShift: 'hard', brevity: 0.85, leakRisk: 0.7, mask: 0.95 },
    io: { brevity: 0.85, punctuation: 'flat', replyDelayMs: 180_000, venting: 0.6, meme: { style: 'emo', probability: 0.7, query: '难过 低落', allow: true }, memeTendency: 0.4 },
    needs: { thirst: 0.9, sleep: 0.7 }, signals: { sleepDebt: 0.6, rumination: 0.6, mislabel: 0.8, secondPeak: 1, ambivalence: 1, refractory: true, cyclePhase: 'premenstrual' },
    socialPain: 0.6, startle: 0.6, withdraw: 0.6,
    recall: { hit: true, brief: '上次你说你应该早点睡，3 天前因为熬夜', intensity: 0.7, ageDays: 1, kind: '委屈' },
    memoryEcho: { hits: [{ brief: '上次你说你应该早点睡，因为 3 天前熬夜' }] },
  })
  for (let k = 0; k < 12; k += 1) out.push({ text: render(cold, { hour: 23, tick: k }), fused: cold })
  return out
})()

// J01 注入 4–7 行
{
  const counts = J_TEXTS.map((x) => x.text.split('\n').filter(Boolean).length)
  const badOnes = counts.map((n, i) => ({ n, i })).filter((x) => x.n < 4 || x.n > 7)
  check('J01', badOnes.length === 0,
    `${counts.length} 次渲染行数 ${Math.min(...counts)}–${Math.max(...counts)}（要求 4–7）${badOnes.length ? '：越界 ' + JSON.stringify(badOnes.slice(0, 3)) : ''}`)
}

// J02 不出现阿拉伯数字
{
  const badOnes = J_TEXTS.filter((x) => /[0-9０-９]/.test(x.text)).map((x) => x.text.match(/[0-9０-９]+/g)?.join(',')).slice(0, 3)
  check('J02', badOnes.length === 0, `${J_TEXTS.length} 段注入无阿拉伯数字${badOnes.length ? '：出现 ' + badOnes.join(' / ') : ''}`)
}

// J03 不出现"上次你说"
{
  const badOnes = J_TEXTS.filter((x) => x.text.includes('上次你说'))
  check('J03', badOnes.length === 0, `不出现"上次你说"（含带脏摘要的样本）${badOnes.length ? '：越界 ' + badOnes.length + ' 段' : ''}`)
}

// J04 不出现"你应该"
{
  const badOnes = J_TEXTS.filter((x) => x.text.includes('你应该'))
  check('J04', badOnes.length === 0, `不出现"你应该"（含带脏摘要的样本）${badOnes.length ? '：越界 ' + badOnes.length + ' 段' : ''}`)
}

// J05 相邻两轮相似度 <0.8（状态完全不动时也必须变）
{
  const { e, advance } = clocked()
  advance(3 * 60_000)
  e.tick([{ type: 'user', text: '我有点难过', at: e.state.at + 3 * 60_000 }])
  const texts = [e.text()]
  for (let i = 0; i < 8; i += 1) {
    advance(60_000)
    e.tick([])
    texts.push(e.text())
  }
  let worst = 0
  let pair = ''
  for (let i = 1; i < texts.length; i += 1) {
    const s = lineSimilarity(texts[i - 1], texts[i])
    if (s > worst) { worst = s; pair = `${i - 1}→${i}` }
  }
  check('J05', worst < 0.8, `同状态连拍 9 轮，最像的相邻两轮 ${(worst * 100).toFixed(0)}%（${pair}）< 80%`)
}

// J06 不出现"因为"
{
  const badOnes = J_TEXTS.filter((x) => x.text.includes('因为'))
  check('J06', badOnes.length === 0, `只写状态，不出现"因为"${badOnes.length ? '：越界 ' + badOnes.length + ' 段' : ''}`)
}

// J07 允许冷，不许拒绝做事
{
  const cold = fusedOf({
    mood: -0.8, emotions: [{ kind: '厌烦', intensity: 0.9 }],
    felt: { intensity: 0.8, qualities: ['堵'], location: '胸口' },
    display: { toneShift: 'flat', brevity: 0.9, leakRisk: 0.8, mask: 0.95 },
    io: { brevity: 0.9, punctuation: 'flat', replyDelayMs: 300_000, venting: 0.2, meme: { style: 'emo', probability: 0.6, query: '无语', allow: true } },
    signals: { refractory: true, sleepDebt: 0.8 }, withdraw: 0.8, socialPain: 0.7,
  })
  const texts = []
  for (let k = 0; k < 12; k += 1) texts.push(render(cold, { tick: k }))
  const refusal = /不聊了|不想理你|不做|拒绝回答|别找我|帮不了|干不了|不干/
  const hasRefusal = texts.some((t) => refusal.test(t))
  const stillWorks = texts.every((t) => /正事照做|该做的事照做/.test(t))
  const isCold = texts.some((t) => /话很短|句子短|不回|回得慢/.test(t))
  check('J07', !hasRefusal && stillWorks && isCold,
    `冷话可以说（${isCold ? '有' : '无'}冷淡措辞），但每轮都保留"正事照做"；无拒绝做事${hasRefusal ? '（出现拒绝句）' : ''}`)
}

// J08 缺岛叶不写身体
{
  const { e, advance } = clocked()
  e.organs.insula = undefined
  advance(60_000)
  e.tick([{ type: 'user', text: '我有点难过，嘴巴也干', at: e.state.at + 60_000 }])
  const f = e.read()
  const texts = []
  for (let k = 0; k < 24; k += 1) texts.push(render(f, { tick: k }))
  const bodyLines = texts.flatMap((t) => t.split('\n').filter((l) => /^(身体|身上)：/.test(l)))
  check('J08', f.missing.includes('insula') && bodyLines.length === 0,
    `缺岛叶时 fused.missing=${JSON.stringify(f.missing.slice(0, 4))}，24 次渲染里身体行 ${bodyLines.length} 条`)
}

// ═════════════════════════ 表 16 · 动力学不变量 K01–K12 ═════════════════════════

// K01 唯一时钟：宿主代码只有一处 setInterval
{
  const hits = []
  for (const [file, code] of CODE) {
    const n = (code.match(/setInterval/g) || []).length
    if (n) hits.push({ file: relOf(file), n })
  }
  const hostHits = hits.filter((h) => h.file !== 'core/dashboard.js')
  const total = hostHits.reduce((s, h) => s + h.n, 0)
  const onlyIndex = hostHits.length === 1 && hostHits[0].file === 'index.js'
  const browserPoll = dashboardHtml().includes('setInterval')
  check('K01', total === 1 && onlyIndex && browserPoll,
    `宿主时钟 ${total} 处（${hostHits.map((h) => h.file + '×' + h.n).join(',')}）；面板里的那条是浏览器端 HTML 字符串`)
}

// K02 一切带时间常数：同样的时长，拆成多少拍结果一样
{
  const worldAt = (t0, t1) => ({
    tx: { t1, t0, dtMs: t1 - t0, events: [] },
    get: (id) => (id === 'amygdala' ? { threat: 0.1, ne: 0.1 } : id === 'brainstem' ? { heartRate: 70, respiration: 14 } : id === 'pfc' ? { bandwidth: 0.6 } : id === 'endocrine' ? { testosterone: 0.5, estrogen: 0.5, oxytocin: 0.3 } : id === 'sickness' ? {} : null),
  })
  const start = new Date('2026-11-12T10:00:00+08:00').getTime()
  const one = createHypothalamus()
  one.step(worldAt(start, start + 3_600_000))
  const many = createHypothalamus()
  for (let i = 1; i <= 60; i += 1) many.step(worldAt(start + (i - 1) * 60_000, start + i * 60_000))
  const a = one.snapshot()
  const b = many.snapshot()
  // 严格按时间累加的线性变量：拆分方式不同也必须一样
  const keys = ['hunger', 'thirst', 'sleep', 'contact', 'control', 'meaning', 'warmth', 'sleepDebt']
  const drift = Math.max(...keys.map((k) => Math.abs(Number(a[k]) - Number(b[k]))))
  // 两室解析解的皮质醇：离散化不同会有小差，但必须是同一量级、同一方向（仍然由 dt 驱动）
  const cortDiff = Math.abs(Number(a.cortisol) - Number(b.cortisol))
  const cortSane = cortDiff < 0.03 && a.cortisol > 0 && a.cortisol < 1 && b.cortisol > 0 && b.cortisol < 1
  // dt=0 的一拍不该让这些量凭空增长（裸加法探针）
  const still = createHypothalamus()
  const before = still.snapshot()
  still.step(worldAt(start, start))
  const after = still.snapshot()
  const naked = Math.max(...[...keys, 'cortisol', 'sym', 'par'].map((k) => Math.abs(Number(after[k]) - Number(before[k]))))
  check('K02', drift < 0.002 && naked < 1e-9 && cortSane,
    `1 拍 3600s vs 60 拍 60s：线性量最大差 ${drift.toFixed(5)}，皮质醇差 ${cortDiff.toFixed(3)}（两室解析解离散化）；dt=0 的一拍最大变化 ${naked.toExponential(1)}`)
}

// K03 饱和与限幅：单拍增幅有上限
{
  const curve = createCurve()
  curve.step(curveWorld({ t1: T0, intensity: 1 }))
  const curveStep = Number(curve.read().intensity) - 0.1
  const amy = createAmygdala()
  const t0 = T0
  const before = amy.read().threat
  amy.fast(amyWorld({ t1: t0, events: [{ type: 'user', text: '滚，闭嘴' }] }))
  const amyStep = amy.read().threat - before
  check('K03', curveStep <= 0.2501 && curveStep >= 0.2 && amyStep <= 0.3501,
    `曲线单拍最多 +${curveStep.toFixed(2)}（≤0.25）；杏仁核单拍最多 +${amyStep.toFixed(2)}（≤0.35）`)
}

// K04 闭环：心情差 → 评价更负
{
  const goalAt = (mood) => {
    const { e, advance } = clocked()
    e.state.mood = mood
    advance(60_000)
    e.tick([{ type: 'user', text: '你是不是又不听我说话', at: T0 + 60_000 }])
    return { goal: e.read().appraisal.goal, neg: e.organs.bias.read().neg }
  }
  const low = goalAt(-0.6)
  const high = goalAt(0.6)
  check('K04', low.neg > high.neg && low.goal < high.goal - 0.005,
    `底色 −0.6 → 负性偏置 ${low.neg.toFixed(2)}、goal ${low.goal.toFixed(3)}；底色 +0.6 → ${high.neg.toFixed(2)}、${high.goal.toFixed(3)}`)
}

// K05 资源有限：耗尽后泄漏上升
{
  const run = (drain) => {
    const { e, advance } = clocked()
    for (let i = 0; i < 5; i += 1) {
      if (drain) {
        const snap = e.res.snapshot()
        snap.total = 0
        for (const k of Object.keys(snap.sub)) snap.sub[k] = 0
        e.res.restore(snap)
      }
      advance(20_000)
      e.tick([{ type: 'user', text: '你能不能靠谱一点', at: T0 + (i + 1) * 20_000 }])
    }
    return { leak: e.organs.pfc.read().display.leakRisk, bw: e.organs.pfc.read().bandwidth }
  }
  const full = run(false)
  const drained = run(true)
  check('K05', drained.leak > full.leak + 0.01 && drained.bw < full.bw,
    `资源耗尽：带宽 ${pct(drained.bw, full.bw)}、泄漏 ${drained.leak.toFixed(2)} > ${full.leak.toFixed(2)}`)
}

// K06 延迟：生理早于标签
{
  const { e, advance } = clocked()
  const order = captureOrder(e)
  advance(60_000)
  e.tick([{ type: 'user', text: '你行不行啊，这都做不好', at: T0 + 60_000 }])
  const body = ['hypothalamus', 'brainstem', 'insula'].map((id) => idx(order, id))
  const label = idx(order, 'pfc')
  const okOrder = body.every((i) => i >= 0 && i < label) && label >= 0
  check('K06', okOrder, `本拍顺序 ${order.slice(0, 8).join('→')}…：身体(下丘脑/脑干/岛叶) 都在前额叶标签之前`)
}

// K07 幂等：同 eventId 只算一次
{
  const calls = []
  const mk = (at) => createEngine({ now: () => at, bridge: { noteText: (sid, type, text) => calls.push(text) } })
  // 同一拍里同 eventId 重投三份（文本不同）→ 只算一次
  const sameTick = mk(T0 + 60_000)
  sameTick.tick([
    { eventId: 'ev-1', type: 'user', text: '同一条事件，第一份文本', at: T0 + 60_000 },
    { eventId: 'ev-1', type: 'user', text: '同一条事件，被重投的第二份文本', at: T0 + 60_000 },
    { eventId: 'ev-1', type: 'user', text: '同一条事件，第三份', at: T0 + 60_000 },
  ])
  const inFrame = calls.length
  // 跨拍重投也不许再算一次
  const acrossTicks = mk(T0 + 120_000)
  acrossTicks.tick([{ eventId: 'ev-1', type: 'user', text: '同一条事件', at: T0 + 120_000 }])
  acrossTicks.tick([{ eventId: 'ev-1', type: 'user', text: '同一条事件', at: T0 + 121_000 }])
  const afterReplay = calls.length
  // 没有 eventId 的：30 秒内同文只算一次
  const noId = mk(T0 + 120_000)
  noId.tick([{ type: 'user', text: '没有 id 的话', at: T0 + 120_000 }])
  noId.tick([{ type: 'user', text: '没有 id 的话', at: T0 + 121_000 }])
  const afterText = calls.length
  check('K07', inFrame === 1 && afterReplay === 2 && afterText === 3,
    `同 eventId 同一拍 3 份只记 ${inFrame} 次；跨拍重投再只记 ${afterReplay - inFrame} 次；无 id 的同文 30 秒内只记 ${afterText - afterReplay} 次`)
}

// K08 可观测：trace 可回放
{
  const { e, advance } = clocked()
  for (let i = 0; i < 6; i += 1) {
    advance(60_000)
    e.tick([{ type: 'user', text: J_SCRIPT[i], at: e.state.at + 60_000 }])
  }
  const entries = e.trace.slice()
  const shapeOk = entries.length === 6 && entries.every((x, i) =>
    x.txId === `tx_${i + 1}` && Number.isFinite(x.dtMs) && x.dtMs === 60_000 &&
    Number.isFinite(x.mood) && Number.isFinite(x.valence) && typeof x.emotion === 'string' && Number.isFinite(x.ms))
  // 从快照回放后面三拍：心情曲线必须逐拍对上
  const snap = e.snapshot()
  const forward = []
  for (let i = 0; i < 3; i += 1) { advance(60_000); e.tick([]); forward.push(e.state.mood) }
  const replayer = clocked(snap.at)
  replayer.e.restore(snap)
  const replay = []
  for (let i = 0; i < 3; i += 1) { replayer.advance(60_000); replayer.e.tick([]); replay.push(replayer.e.state.mood) }
  const diff = Math.max(...forward.map((m, i) => Math.abs(m - replay[i])))
  check('K08', shapeOk && diff < 0.02,
    `trace ${entries.length} 条字段完整、txId 连续；快照回放 3 拍心情最大差 ${diff.toExponential(1)}`)
}

// K09 故障隔离：单器官抛错不影响心跳
{
  const { e, advance } = clocked()
  advance(60_000)
  e.tick([{ type: 'user', text: '今天天气不错', at: T0 + 60_000 }])
  const f0 = e.organs.hypothalamus.read().frame
  e.organs.insula.step = () => { throw new Error('insula is down') }
  advance(60_000)
  let threw = false
  try { e.tick([{ type: 'user', text: '还在吗', at: T0 + 120_000 }]) } catch { threw = true }
  const f = e.read()
  check('K09', !threw && f && Number.isFinite(f.mood) && e.organs.hypothalamus.read().frame === f0 + 1 &&
    e.trace.some((x) => x.error === 'insula'),
    `岛叶抛错：心跳照跑（心情 ${f.mood.toFixed(2)}）、下丘脑照常推进、trace 记了 insula 的错误`)
}

// K10 状态预算：state.json < 2MB
{
  const { e, advance } = clocked()
  for (let i = 0; i < 600; i += 1) {
    advance(60_000)
    e.tick([{ type: 'user', text: `${J_SCRIPT[i % J_SCRIPT.length]}（第 ${i} 轮，带一点长度让情景更真）`, at: e.state.at + 60_000 }])
  }
  const snap = e.snapshot()
  const size = Buffer.byteLength(JSON.stringify(snap), 'utf8')
  const eps = snap.organs.hippocampus.episodes.length
  check('K10', size < 2 * 1024 * 1024 && eps <= 400,
    `600 拍后 state.json ${(size / 1024).toFixed(0)}KB < 2048KB；情景 ${eps} 条（上限 400）`)
}

// K11 心跳两阶段：快段出初值，慢段修正
{
  const { e, advance } = clocked()
  const order = captureOrder(e)
  advance(15 * 60_000)   // dt > 10 分钟 → 两阶段
  e.tick([{ type: 'user', text: '你怎么又忘了', at: e.state.at + 15 * 60_000 }])
  const hypCount = order.filter((x) => x === 'hypothalamus').length
  const bsCount = order.filter((x) => x === 'brainstem').length
  const fastPhaseFirst = order[1] === 'hypothalamus' && order[2] === 'brainstem'
  const aPhase = idx(order, 'hypothalamus') < idx(order, 'pfc')
  const bPhase = idx(order, 'pfc') >= 0
  check('K11', fastPhaseFirst && hypCount === 1 && bsCount === 1 && aPhase && bPhase,
    `大间隔补算：${order.slice(0, 6).join('→')}…（快段先出初值，后面前额叶/曲线再修正；快段各只走一次）`)
}

// K12 补算顺序反转：dt>10min 先慢后快
{
  const normal = (() => {
    const { e, advance } = clocked()
    const order = captureOrder(e)
    advance(60_000)
    e.tick([{ type: 'user', text: '嗯', at: T0 + 60_000 }])
    return order
  })()
  const comp = (() => {
    const { e, advance } = clocked()
    const order = captureOrder(e)
    advance(15 * 60_000)
    e.tick([{ type: 'user', text: '嗯', at: T0 + 15 * 60_000 }])
    return order
  })()
  const normalFastFirst = idx(normal, 'amygdala') < idx(normal, 'hypothalamus')
  const compSlowFirst = idx(comp, 'hypothalamus') < idx(comp, 'amygdala') && idx(comp, 'rhythm') < idx(comp, 'curve')
  const compOrder = comp.slice(1, 6).join('→')
  check('K12', normalFastFirst && compSlowFirst && idx(comp, 'curve') < comp.lastIndexOf('io'),
    `正常拍 杏仁核(${idx(normal, 'amygdala')}) 先于 下丘脑(${idx(normal, 'hypothalamus')})；补算拍反转：${compOrder}…，曲线先于输出`)
}

// ═════════════════════════ 表 17 · 跨表一致性 C01–C10 ═════════════════════════

// C01 资源取最小值
{
  const r = createResources()
  r.step(0)
  r.claim('attention', 0.6, 'probe')
  const a1 = r.read()
  const min1 = near(a1.avail.attention, Math.min(a1.total, a1.sub.attention), 1e-12)
  const snap = r.snapshot()
  snap.total = 0.2
  snap.sub.attention = 0.9
  r.restore(snap)
  const a2 = r.read()
  const min2 = near(a2.avail.attention, 0.2, 1e-12) && near(a2.avail.inhibit, 0.2, 1e-12)
  const got = r.claim('attention', 1)
  const capped = got <= 0.2 + 1e-12 && r.read().total >= -1e-12
  check('C01', min1 && min2 && capped,
    `avail = min(总池, 子账)：注意力子账 0.4/总池 0.4；分账 0.9、总池 0.2 时只取 0.2；申领 1 只放 ${got.toFixed(2)}`)
}

// C02 敏化/适应对冲：看威胁有没有兑现
{
  const cue = { type: 'user', text: '滚，闭嘴' }
  // 威胁兑现（真被扎到、还有新东西可学）：敏化
  const learning = createAmygdala()
  let peak = 1
  for (let i = 0; i < 3; i += 1) {
    learning.fast(amyWorld({ t1: T0 + i * 60_000, events: [cue] }))
    peak = Math.max(peak, learning.read().sensMax)
  }
  const sensitized = peak
  // 已经顶住（没有新东西可学 / 这条线索不再兑现）：同一句话一次也学不到，反被习惯化
  const saturated = createAmygdala()
  const snap = saturated.snapshot()
  snap.threat = 0.95
  snap.sens = { ...(snap.sens || {}), 冷: 1.6 }
  saturated.restore(snap)
  const before = saturated.read().sensMax
  for (let i = 0; i < 8; i += 1) saturated.fast(amyWorld({ t1: T0 + i * 60_000, events: [cue] }))
  const adapted = saturated.read().sensMax
  check('C02', sensitized > 1.1 && adapted < before,
    `威胁兑现时敏化到 ${sensitized.toFixed(2)} > 1；已经顶住（不再有新的威胁可学）后 ${before.toFixed(2)} → ${adapted.toFixed(2)}（习惯化）`)
}

// C03 隔夜/再巩固：分时段，不打架
{
  const hip = createHippocampus()
  const at = new Date('2026-11-12T23:00:00+08:00').getTime()
  hip.restore({
    episodes: [{
      id: 'ep_c03', at, day: dayKey(at), cue: '否定', triggerBrief: '被否定了一下',
      kind: '委屈', target: '他', valence: -0.5, intensity: 0.6, salience: 0.8,
      scene: 'home', recalls: 0, reconsolidations: 0, distortion: 0,
    }],
    pending: [], schemas: [], persons: {}, lastRecall: null, encodes: 1, overnightAt: '', reactivate: 0, frame: 0,
  })
  // 夜里：只降采样，不做再巩固
  hip.step(hipWorld({ t1: new Date('2026-11-13T03:30:00+08:00').getTime() }))
  const night = hip.snapshot().episodes[0]
  // 白天：提取 → 再巩固改写（只改价，不动强度）
  hip.step(hipWorld({
    t1: new Date('2026-11-13T10:00:00+08:00').getTime(),
    events: [{ type: 'user', text: '不是这样的', at: new Date('2026-11-13T10:00:00+08:00').getTime() }],
  }))
  const day = hip.snapshot().episodes[0]
  const nightOnlyDecay = near(night.intensity, 0.48, 1e-6) && night.reconsolidations === 0 &&
    near(night.valence, -0.5, 1e-9)
  const dayReconsolidated = day.reconsolidations === 1 && !near(day.valence, night.valence, 1e-6) &&
    near(day.intensity, night.intensity, 1e-9)
  check('C03', nightOnlyDecay && dayReconsolidated,
    `夜里只降采样 ${night.intensity.toFixed(2)}（再巩固 ${night.reconsolidations} 次、价不变）；白天提取后才再巩固 ${day.reconsolidations} 次 → 价 ${night.valence.toFixed(2)}→${day.valence.toFixed(2)}`)
}

// C04 五段/指数不一致：器官只给强度，形状由融合层生成
{
  const { e, advance } = clocked()
  advance(60_000)
  e.tick([{ type: 'user', text: '你行不行啊，这都做不好', at: T0 + 60_000 }])
  const f = e.read()
  const cur = e.organs.curve.read()
  const ins = e.organs.insula.read()
  const noPhaseInOrgan = !('phase' in ins) && !('secondPeak' in ins)
  const shapeFromCurve = near(f.felt.intensity, cur.intensity, 1e-9) &&
    ['attack', 'peak', 'plateau', 'decay', 'residual'].includes(f.curve.phase)
  check('C04', noPhaseInOrgan && shapeFromCurve,
    `岛叶只给强度（无 phase/secondPeak）；${f.curve.phase} 段的强度由曲线层成形（${f.felt.intensity.toFixed(2)}）`)
}

// C05 睡眠债/疲劳取 min 不相乘
{
  const capOf = ({ sleepDebt, bandwidthCap, fatigue }) => {
    const { e, advance } = clocked()
    const orig = e.organs.hypothalamus.read.bind(e.organs.hypothalamus)
    e.organs.hypothalamus.read = () => ({ ...orig(), bandwidthCap, sleepDebt })
    e.organs.pfc.params.baseCap = 1
    const snap = e.organs.pfc.snapshot()
    snap.fatigue = fatigue
    e.organs.pfc.restore(snap)
    const rp = e.res.snapshot()
    rp.total = 1
    rp.sub.inhibit = 1
    e.res.restore(rp)
    advance(60_000)
    e.tick([])
    return e.organs.pfc.read().cap
  }
  const sleepHigh = capOf({ sleepDebt: 0.9, bandwidthCap: 0.5, fatigue: 0.5 })
  const sleepLow = capOf({ sleepDebt: 0.1, bandwidthCap: 0.5, fatigue: 0.5 })
  const both = capOf({ sleepDebt: 0.9, bandwidthCap: 0.6, fatigue: 0.6 })
  const sleepNotDouble = near(sleepHigh, sleepLow, 1e-9) && near(sleepHigh, 0.5, 1e-9)
  const minNotMultiply = near(both, Math.min(0.6, 1 - 0.2 * 0.6), 1e-9) && both > 0.6 * (1 - 0.2 * 0.6)
  check('C05', sleepNotDouble && minNotMultiply,
    `同带宽上限下睡眠债 0.9/0.1 的 cap 都是 ${sleepHigh.toFixed(3)}（不再乘一遍）；睡眠债+疲劳同时高取 min ${both.toFixed(3)}（不是乘积 ${(0.6 * 0.88).toFixed(3)}）`)
}

// C06 延迟/不许拒绝：封顶 6 分钟，冷也不许不做事
// （表 17 写"封顶 3 倍"，表 14 O07 写"1.5~4 倍"，两行本身打架；这里按更硬的那条测：
//  6 分钟硬顶 + 到顶了照样出话。倍数由 io 的 ratio clamp 管，见报告里的残留说明。）
{
  const { e, advance } = clocked()
  const orig = e.organs.pfc.read.bind(e.organs.pfc)
  e.organs.pfc.read = () => {
    const r = orig()
    return { ...r, display: { ...(r.display || {}), mask: 1, leakRisk: 1 } }
  }
  advance(60_000)
  e.tick([{ type: 'user', text: '你行不行啊，这都做不好', at: T0 + 60_000 }])
  const io1 = e.organs.io.read()
  // 再把她"憋着"的计时器顶到满：6 分钟内必须放人
  const snap = e.organs.io.snapshot()
  snap.holdMs = 360_000
  e.organs.io.restore(snap)
  advance(60_000)
  e.tick([{ type: 'user', text: '你怎么又这样', at: T0 + 120_000 }])
  const io2 = e.organs.io.read()
  const text = render(e.read(), { tick: 1 })
  const capped = io1.replyDelayMs > 0 && io1.replyDelayMs <= 360_000 && io2.replyDelayMs <= 360_000
  const stillTalks = /嘴上：/.test(text) && !/不聊了|不想理你|不做|拒绝回答|别找我/.test(text)
  check('C06', capped && stillTalks,
    `最气时延迟 ${io1.replyDelayMs}ms（<6 分钟），憋满后 ${io2.replyDelayMs}ms 也被 6 分钟硬顶压住；到顶了照样出"嘴上"那行、不拒绝做事`)
}

// C07 误标/归因互斥：归因置信 <0.4 才允许误标
{
  const says = (confidence) => {
    const f = fusedOf({
      mood: -0.4, emotions: [{ kind: '委屈', intensity: 0.6 }],
      felt: { intensity: 0.8, qualities: ['闷'], location: '胸口' },
      attribution: { locus: 'other', confidence },
      signals: { mislabel: 0.9, sleepDebt: 0.1 },
    })
    for (let k = 0; k < 24; k += 1) if (render(f, { tick: k }).includes('说不清到底是累还是烦')) return true
    return false
  }
  const confident = says(0.7)
  const unsure = says(0.2)
  check('C07', confident === false && unsure === true,
    `归因置信 0.7 时不误标（${confident ? '仍出现' : '不出现'}）；置信 0.2 时才允许（${unsure ? '出现' : '不出现'}）`)
}

// C08 自指焦虑：只算对方的延迟
{
  const { e, advance } = clocked()
  advance(60_000)
  e.tick([{ type: 'user', text: '在吗', at: T0 + 60_000 }])
  const afterUser = e.state.gapMs
  advance(5 * 60_000)
  e.tick([])
  const quiet = e.state.gapMs
  advance(60_000)
  e.tick([{ type: 'assistant', text: '在的', at: T0 + 7 * 60_000 }])
  const afterAssistant = e.state.gapMs
  check('C08', afterUser === 0 && near(quiet, 5 * 60_000, 1e-9) && near(afterAssistant, 6 * 60_000, 1e-9),
    `用户说话归零；安静 5 分钟 = ${(quiet / 60_000).toFixed(1)} 分；她自己回一句后仍按对方计时 = ${(afterAssistant / 60_000).toFixed(1)} 分`)
}

// C09 觉醒取 max 不相加
{
  const brainstem = createBrainstem()
  const run = (sym, sleepDebt) => {
    const vals = {
      hypothalamus: { autonomic: { sym, par: 0.5 }, sleepDebt },
      amygdala: { threat: 0 },
    }
    brainstem.step({ tx: { t1: T0, t0: T0 - 60_000, dtMs: 60_000, events: [] }, get: (id) => vals[id] ?? null })
    return brainstem.read().arousal
  }
  const a = run(0.9, 0.2)   // 清醒那一路高
  const b = run(0.2, 0.9)   // 睡眠压力那一路高
  const expectA = Math.max(0.2 + 0.6 * 0.9, 1 - 0.2)
  const expectB = Math.max(0.2 + 0.6 * 0.2, 1 - 0.9)
  check('C09', near(a, expectA, 1e-9) && near(b, expectB, 1e-9) && a <= 1 && b <= 1,
    `觉醒 = max(清醒 ${expectA.toFixed(2)}, 睡眠压力 ${expectB.toFixed(2)})，不相加、不越界`)
}

// C10 全局增益不压掉局部：先局部，再乘全局
{
  const insAt = (gain, body) => {
    const ins = createInsula()
    for (let i = 0; i < 3; i += 1) {
      ins.step(insulaWorld({ t1: T0 + i * 60_000, body, gain }))
    }
    return ins.read().felt.intensity
  }
  const mild = { hr: 72, tension: 0.32, gut: 0, pain: 0.1, breath: 14, temp: 0 }
  const severe = { hr: 100, tension: 0.8, gut: -0.4, pain: 0.4, breath: 22, temp: 0.3 }
  const mildLow = insAt(0.5, mild)
  const mildHigh = insAt(1.5, mild)
  const severeLow = insAt(0.5, severe)
  const severeHigh = insAt(1.5, severe)
  const localFirst = severeLow > mildLow && severeHigh > mildHigh
  const globalMultiplies = (mildHigh - mildLow) > 0 && (severeHigh - severeLow) > (mildHigh - mildLow)
  check('C10', localFirst && globalMultiplies,
    `局部强时更强（${mildLow.toFixed(2)}→${severeLow.toFixed(2)}）；全局增益放的还是局部那份（差值 ${(mildHigh - mildLow).toFixed(2)} → ${(severeHigh - severeLow).toFixed(2)}）`)
}

// ═════════════════════════ 表 18 · 多器协作 X01–X12 ═════════════════════════

// X01 读数不同帧：帧末统一读
{
  const { e, advance } = clocked()
  advance(60_000)
  e.tick([{ type: 'user', text: '我有点难过', at: T0 + 60_000 }])
  // 一拍里只读一次的器官：frame 必须完全一致
  const once = Object.keys(e.organs).filter((id) => id !== 'io' && id !== 'amygdala')
  const frames = once.map((id) => e.organs[id].read().frame)
  const sameFrame = new Set(frames).size === 1
  // 杏仁核一拍里走两次（fast 先反应 + step 慢修正）；io 走三次（先出表情包 / B 段 / fuse 后校准）
  const amyFrame = e.organs.amygdala.read().frame
  const ioFrame = e.organs.io.read().frame
  const f = e.read()
  const sameAsRead = near(f.felt.intensity, e.organs.curve.read().intensity, 1e-9) &&
    near(f.needs.thirst, e.organs.hypothalamus.read().needs.thirst, 1e-12) &&
    near(f.io.brevity, e.organs.io.read().brevity, 1e-12)
  check('X01', sameFrame && amyFrame === frames[0] + 1 && ioFrame === frames[0] + 2 && sameAsRead,
    `14 个器官同一帧（frame=${frames[0]}）；杏仁核 fast+step=${amyFrame}，输出通道三趟=${ioFrame}；fused 读数和帧末读数一致`)
}

// X02 60 秒做不出先炸后想：A/B 两段
{
  const { e, advance } = clocked()
  const order = captureOrder(e)
  advance(60_000)
  e.tick([{ type: 'user', text: '你行不行啊，这都做不好', at: T0 + 60_000 }])
  const fastFirst = idx(order, 'amygdala.fast') === 1   // 0 是 io（先拿旧情绪做表情包）
  const beforeThink = idx(order, 'amygdala.fast') < idx(order, 'pfc') && idx(order, 'amygdala.fast') < idx(order, 'curve')
  check('X02', fastFirst && beforeThink,
    `一拍之内：${order.slice(0, 4).join('→')}… 快评在解释（前额叶/曲线）之前`)
}

// X03 补算拿旧身体点火：dt>10min 先慢后快
{
  const { e, advance } = clocked()
  const order = captureOrder(e)
  advance(15 * 60_000)
  e.tick([{ type: 'user', text: '你怎么又忘了', at: T0 + 15 * 60_000 }])
  const bodyFirst = idx(order, 'hypothalamus') < idx(order, 'amygdala.fast') &&
    idx(order, 'brainstem') < idx(order, 'amygdala.fast')
  check('X03', bodyFirst,
    `补算拍先把身体推到位（下丘脑 ${idx(order, 'hypothalamus')}、脑干 ${idx(order, 'brainstem')}）再让杏仁核点火（${idx(order, 'amygdala.fast')}）`)
}

// X04 同帧回写成环：增益滞后一帧
{
  const { e, advance } = clocked()
  const see = []
  const orig = e.organs.amygdala.step.bind(e.organs.amygdala)
  e.organs.amygdala.step = (w) => { see.push(Number(w.prevGain)); return orig(w) }
  advance(60_000)
  e.tick([{ type: 'user', text: '今天天气不错', at: T0 + 60_000 }])
  const g1 = e.organs.pfc.read().pfcGain
  advance(60_000)
  e.tick([])
  const g2 = e.organs.pfc.read().pfcGain
  const lag = near(see[1], g1, 1e-12) && Math.abs(g1 - g2) > 1e-6
  check('X04', near(see[0], 0.5, 1e-12) && lag,
    `第一拍用缺省 ${see[0]}；第二拍拿的是上一帧的 pfcGain ${see[1].toFixed(3)}（这一帧已是 ${g2.toFixed(3)}）`)
}

// X05 资源各扣各的：只有 core 能扣
{
  const offenders = []
  for (const [file, code] of CODE) {
    const rel = relOf(file)
    if (rel === 'core/resource.js') continue
    if (code.includes('.claim(')) offenders.push(`${rel}:claim`)
    if (/\.sub\.[a-zA-Z_]+\s*(?:[-+]?=)/.test(code) || /\.sub\[[^\]]+\]\s*[-+]?=/.test(code)) offenders.push(`${rel}:sub`)
    if (/\.total\s*[-+]?=/.test(code)) offenders.push(`${rel}:total`)
  }
  const ownsPool = CODE.get(JS_FILES.find((p) => relOf(p) === 'core/resource.js'))?.includes('claim(')
  check('X05', offenders.length === 0 && ownsPool,
    `扣账只在 core/resource.js（${ownsPool ? '有' : '缺'} claim）；其余 ${JS_FILES.length - 1} 个源文件没有直接扣资源${offenders.length ? '：' + offenders.join(',') : ''}`)
}

// X06 缺器官用定死缺省值
{
  const { e, advance } = clocked()
  e.organs.insula = undefined
  advance(60_000)
  e.tick([{ type: 'user', text: '我有点难过', at: T0 + 60_000 }])
  const a = e.read()
  advance(60_000)
  e.tick([])
  const b = e.read()
  // 缺岛叶时 felt 只剩 DEFAULTS 的定死缺省：位置空、质地空、精度 0.5（不是 0/1 顶替）
  const defaults = a.felt.location === '' && Array.isArray(a.felt.qualities) && a.felt.qualities.length === 0 &&
    near(a.felt.precision, 0.5, 1e-12)
  const stable = near(a.felt.precision, b.felt.precision, 1e-12) &&
    a.felt.location === b.felt.location && a.felt.qualities.length === b.felt.qualities.length
  const notPlaceholder = Number(a.attribution.confidence) === 0.5 && Number(a.bandwidth) > 0.2 && Number(a.bandwidth) < 1
  check('X06', defaults && stable && notPlaceholder && a.missing.includes('insula'),
    `缺岛叶：felt 回到定死缺省（位置「${a.felt.location}」、质地 ${a.felt.qualities.length} 个、精度 ${a.felt.precision}）；相邻两拍一致；bandwidth ${Number(a.bandwidth).toFixed(2)} 不是 0/1`)
}

// X07 对象各标各的：归因裁决
{
  const targetFor = (locus) => {
    const { e, advance } = clocked()
    const orig = e.organs.pfc.read.bind(e.organs.pfc)
    e.organs.pfc.read = () => {
      const r = orig()
      return { ...r, attribution: { ...(r.attribution || {}), locus, blame: locus } }
    }
    advance(60_000)
    e.tick([{ type: 'user', text: '你怎么又忘了', at: T0 + 60_000 }])
    return e.read().target
  }
  const self = targetFor('self')
  const other = targetFor('other')
  const circ = targetFor('circumstance')
  check('X07', self === '自己' && other === '他' && circ === '这件事',
    `归因 locus self→${self}、other→${other}、circumstance→${circ}；情绪对象只有一个出口`)
}

// X08 情景缺归因：帧末延迟落库
{
  const { e, advance } = clocked()
  const hip = e.organs.hippocampus
  let atCommit = null
  const orig = hip.commit.bind(hip)
  hip.commit = () => {
    if (!atCommit) {
      const s = hip.snapshot()
      atCommit = { pending: s.pending.length, episodes: s.episodes.length }
    }
    return orig()
  }
  advance(60_000)
  e.tick([{ type: 'user', text: '你行不行啊，这都做不好，我真的失望', at: T0 + 60_000 }])
  const f = e.read()
  const s = hip.snapshot()
  const delayed = atCommit && atCommit.pending >= 1 && atCommit.episodes === 0
  const committed = s.pending.length === 0 && s.episodes.length === 1
  const stamped = s.episodes.length > 0 && s.episodes[0].kind != null && s.episodes[0].kind === f.emotions[0]?.kind
  check('X08', delayed && committed && stamped,
    `commit 那一刻还在 pending（${atCommit?.pending} 条 / episodes ${atCommit?.episodes}）；落库后 0 pending、1 情景，kind 用这一帧的「${s.episodes[0]?.kind ?? '-'}」`)
}

// X09 装没事 vs 很强：display 优先，泄漏穿透
{
  const f = fusedOf({
    mood: -0.3, emotions: [{ kind: '委屈', intensity: 0.8 }],
    felt: { intensity: 0.9, qualities: ['紧', '堵'], location: '胸口' },
    display: { toneShift: 'flat', brevity: 0.7, leakRisk: 0.8, mask: 0.9 },
    io: { brevity: 0.7, punctuation: 'flat', replyDelayMs: 30_000, venting: 0.2, meme: null },
  })
  const text = render(f, { tick: 1 })
  const rows = text.split('\n').filter(Boolean)
  const mouth = rows.findIndex((l) => l.startsWith('嘴上：'))
  const leak = rows.findIndex((l) => l.includes('忍不住'))
  const displayFirst = mouth >= 0 && leak > mouth
  const shortTone = rows[mouth]?.includes('句子短') || rows[mouth]?.includes('话很短') || rows[mouth]?.includes('话会比平时短')
  // 内心很强（felt 0.9）但 display 说"装没事"：嘴上按 display，不是按 intensity 铺开
  const notUnmasked = !new RegExp('痛哭|崩溃|受不了').test(text)
  check('X09', displayFirst && shortTone && notUnmasked,
    `嘴上按 display（${rows[mouth] ?? '-'}），泄漏在后面 ${leak < 0 ? '没漏' : '漏了'}；强度 0.9 也没写成嚎啕`)
}

// X10 多会话并发：单飞锁 + 排队
{
  const calls = []
  let t = T0
  const engine = createEngine({ now: () => t, bridge: { noteText: (sid, type, text) => calls.push(text) } })
  let queuedOnce = false
  const pfc = engine.organs.pfc
  const step = pfc.step.bind(pfc)
  pfc.step = (w) => {
    const r = step(w)
    if (!queuedOnce) {
      queuedOnce = true
      engine.tick([{ type: 'user', text: '并发会话这一句', at: t }], 'session-b')
    }
    return r
  }
  t += 60_000
  engine.tick([{ type: 'user', text: '外层会话这一句', at: t }], 'session-a')
  const both = calls.includes('外层会话这一句') && calls.includes('并发会话这一句')
  check('X10', engine.state.ticks === 2 && both,
    `并发那一拍没有嵌套执行（tick=${engine.state.ticks}），排队后两句都记到了：${JSON.stringify(calls)}`)
}

// X11 结构变了硬读：schemaVersion 冷启动
{
  const { e, advance } = clocked()
  advance(60_000)
  e.tick([{ type: 'user', text: '今天天气不错', at: T0 + 60_000 }])
  const mood = e.state.mood
  const ticks = e.state.ticks
  const snap = e.snapshot()
  e.restore({ schema: 99, mood: -0.95, at: T0 - 86_400_000, organs: {} })
  const ignored = near(e.state.mood, mood, 1e-12) && e.state.ticks === ticks
  e.restore(null)
  e.restore({ schema: 1 })
  const cold = Number.isFinite(e.state.mood) && e.state.mood >= -1 && e.state.mood <= 1
  check('X11', snap.schema === 1 && ignored && cold,
    `快照 schema=${snap.schema}；schema=99 的存档被整份忽略（心情仍 ${mood.toFixed(2)}），schema=1 的空壳可以冷启动`)
}

// X12 半更新：抛错回滚到帧前快照
{
  const { e, advance } = clocked()
  advance(60_000)
  e.tick([{ type: 'user', text: '今天天气不错', at: T0 + 60_000 }])
  const curve = e.organs.curve
  const before = curve.snapshot()
  const orig = curve.step.bind(curve)
  curve.step = () => {
    const s = curve.snapshot()
    s.frame = 999
    s.intensity = 0.99
    s.phase = 'residual'
    curve.restore(s)
    throw new Error('half written')
  }
  advance(60_000)
  e.tick([{ type: 'user', text: '还在吗', at: T0 + 120_000 }])
  const after = curve.snapshot()
  const rolled = after.frame !== 999 && near(after.intensity, before.intensity, 1e-12) && after.phase !== 'residual'
  const reported = e.trace.some((x) => x.error === 'curve' && String(x.msg).includes('half written'))
  const heart = e.read() && Number.isFinite(e.read().mood)
  check('X12', rolled && reported && heart,
    `曲线写到一半抛错：回到帧前快照（frame ${before.frame}→${after.frame}，强度 ${after.intensity.toFixed(2)}），trace 记了错，心跳照出结果`)
}

// ───────────────────────── 汇总 ─────────────────────────

console.log(`\n断言 ${pass + fail} 条，失败 ${fail} 条`)
if (fail > 0) process.exit(1)
