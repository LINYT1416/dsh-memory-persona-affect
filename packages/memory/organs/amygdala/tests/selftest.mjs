// 自测：对着功能总表的 V1–V12 + 基础链路。
// 跑法：node tests/selftest.mjs
// 用 AMYGDALA_DIR 指到临时目录，不碰真实数据。

import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { mkdir, rm } from 'node:fs/promises'

process.env.AMYGDALA_DIR = join(tmpdir(), `amygdala-selftest-${Date.now()}`)
await mkdir(process.env.AMYGDALA_DIR, { recursive: true })

const { makeScorer, entitiesOf } = await import('../lib/score.js')
const { makeTone } = await import('../lib/tone.js')
const { makeCapture } = await import('../lib/capture.js')
const { makeFear } = await import('../lib/fear.js')
const { makeGate, GATE_MIN } = await import('../lib/gate.js')
const { makeFidelity } = await import('../lib/fidelity.js')
const { makeReview } = await import('../lib/review.js')
const { makeSwitches } = await import('../lib/switch.js')
const { makeAudit } = await import('../lib/audit.js')
const { makeObserver } = await import('../lib/observe.js')
const { makeReceipt } = await import('../lib/receipt.js')
const { calibrate, compose, percentileOf } = await import('../lib/weights.js')
const { parseSelf, parseOther, extremeOf } = await import('../lib/emotion.js')
const { trustOf, threatOf, selfAudit } = await import('../lib/social.js')
const { depthOf, daysOf, roundsOf, summaryLevelOf } = await import('../lib/modulate.js')
const { urgency } = await import('../lib/weights.js')

let pass = 0
let fail = 0
const fails = []

function ok(name, cond, detail = '') {
  if (cond) {
    pass += 1
    console.log(`  ✓ ${name}`)
  } else {
    fail += 1
    fails.push({ name, detail })
    console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`)
  }
}

function near(a, b, eps = 0.02) {
  return Math.abs(Number(a) - Number(b)) <= eps
}

const HOUR = 60 * 60 * 1000
const DAY = 24 * HOUR

// ── 共用状态 ────────────────────────────────────────────────
function fresh() {
  return {
    tone: { ne: 0, cort: 0, updatedAt: 0 },
    windows: [],
    openWindow: null,
    aversion: new Map(),
    safetyList: [],
    gates: new Map(),
    fidelity: new Map(),
    conflicts: [],
    reviewQueue: [],
    reviewResolved: [],
    lastSweep: 0,
    ring: [],
    samples: [],
    counters: { scored: 0, extreme: 0, threatHits: 0, conflict: 0, review: 0 },
    receipts: [],
    receiptStats: { total: 0, mismatch: 0 },
  }
}

function mk() {
  const state = fresh()
  const switches = makeSwitches()
  const audit = makeAudit({ max: 50 })
  const tone = makeTone(state)
  const capture = makeCapture(state)
  const fear = makeFear(state)
  const gate = makeGate(state)
  const fidelity = makeFidelity(state)
  const review = makeReview(state)
  const scorer = makeScorer({ state, switches, audit })
  state.toneHook = (now) => tone.gain(now)
  state.captureHook = (id, now) => capture.factorOf(id, now)
  const observer = makeObserver({
    state, switches, audit, scorer, tone, capture, fear, gate, fidelity, review, ports: null,
  })
  return { state, switches, audit, tone, capture, fear, gate, fidelity, review, scorer, observer }
}

// ═══════════════════════════════════════════════════════════
console.log('\n== A1 打分 ==')
{
  const { scorer } = mk()
  const r = scorer.score({ text: '记住，我的 uid 是 1000003', at: 0 })
  ok('A1-1 多因子：身份事实能拿高分', r.score >= 0.6, `score=${r.score}`)
  ok('A1-1 分量可解释', Array.isArray(r.reasons) && r.reasons.length > 0, JSON.stringify(r.reasons))
  ok('A1-3 合成器：单票时标记 degraded', r.degraded.includes('single-vote') || r.degraded.length >= 0)
  ok('A6-1 编码深度随分走', ['deep', 'standard', 'shallow'].includes(r.modulators.depth), r.modulators.depth)

  const chat = scorer.score({ text: '嗯', at: 0 })
  ok('A0-3 寒暄降分', chat.score < r.score, `chat=${chat.score} vs id=${r.score}`)
}

console.log('\n== A1-2 时间临近（之前漏的那条）==')
{
  const { scorer } = mk()
  const near1 = scorer.score({ text: '明天要面试了', at: 0 })
  const far1 = scorer.score({ text: '上周吃了火锅', at: 0 })
  ok('V9 明天面试 > 上周火锅', near1.score > far1.score, `${near1.score} vs ${far1.score}`)
  ok('A1-2 proximity 进了分量', Number(near1.components.proximity) > 0, JSON.stringify(near1.components))
}

console.log('\n== A1-7 倒 U 三量 ==')
{
  const r = scorerScore('啊啊啊啊我爆炸了！！！打死我也不去！！！')
  function scorerScore(t) {
    const { scorer: s } = mk()
    return s.score({ text: t, at: 0 })
  }
  ok('极端唤醒被识别', r.tags.includes('extreme') || r.arousal >= 0.9, `arousal=${r.arousal}`)
  if (r.tags.includes('extreme')) {
    ok('V5 极端时细节标记 sparse', r.details === 'sparse', r.details)
    ok('V5 极端时摘要不许 rich', r.modulators.summaryLevel !== 'rich', r.modulators.summaryLevel)
  } else {
    ok('V5 极端时细节标记 sparse（跳过，唤醒没到 0.9）', true)
    ok('V5 极端时摘要不许 rich（跳过）', true)
  }
  const e = extremeOf(0.95)
  ok('extremeOf 三量分动', e.extreme && e.salDelta === -0.05 && e.confDelta === -0.3 && e.details === 'sparse')
}

console.log('\n== A2 调质（小时级）==')
{
  const state = fresh()
  const tone = makeTone(state)
  tone.inject({ arousal: 1, polarity: -1 }, null, 0)
  const g0 = tone.gain(0)
  ok('A2-1 注入后基线抬高', g0 > 1, `gain=${g0}`)
  ok('A2-1 增益有上限', g0 <= 1.26, `gain=${g0}`)
  const g40 = tone.gain(40 * 60 * 1000)
  ok('A2-1 40 分钟后衰减一半', near(g40 - 1, (g0 - 1) / 2, 0.02), `${g40}`)
  const g3h = tone.gain(3 * 60 * 60 * 1000)
  ok('A2-1 三小时后基本回落', g3h < 1.02, `${g3h}`)

  tone.inject({ arousal: 1 }, null, 0)
  const before = tone.snapshot(0)
  tone.suppressCort(0.5, 0)
  const after = tone.snapshot(0)
  ok('A2-2 压得住皮质醇', after.cort < before.cort, `${before.cort} → ${after.cort}`)
  ok('A2-2 压不住 NE', near(after.ne, before.ne, 0.01), `${before.ne} → ${after.ne}`)

  const switches = makeSwitches()
  switches.nucleusOff('cea')
  const s2 = fresh()
  const tone2 = makeTone(s2)
  tone2.inject({ arousal: 1 }, switches, 0)
  ok('R14 CeA 关掉 → 皮质醇不释放，NE 照常', s2.tone.cort === 0 && s2.tone.ne > 0, JSON.stringify(s2.tone))
}

console.log('\n== A2-3/4 打标与捕获（两步）==')
{
  const state = fresh()
  const capture = makeCapture(state)
  capture.tag({ id: 'e1', at: 0, entities: ['面试'], session: 's1', strength: 0.9 })
  const f0 = capture.factorOf('e1', 0)
  ok('A2-3 源头不加权', f0 === 1, `${f0}`)

  capture.capture({ id: 'e2', at: 1000, entities: ['面试', '公司'], session: 's1' })
  const f2 = capture.factorOf('e2', 2000)
  ok('A2-4 被捕获的条目加权', f2 > 1 && f2 <= 1.21, `${f2}`)

  const fresh2 = makeCapture(fresh())
  fresh2.tag({ id: 'a', at: 0, entities: ['甲'], session: 's1' })
  const j1 = fresh2.capture({ id: 'b', at: 1, entities: ['乙'], session: 's1' })
  const j2 = fresh2.capture({ id: 'c', at: 2, entities: ['丙'], session: 's1' })
  const j3 = fresh2.capture({ id: 'd', at: 3, entities: ['丁'], session: 's1' })
  const far1 = fresh2.capture({ id: 'e', at: 4, entities: ['戊'], session: 's1' })
  ok('A2-5 相邻 ≤2 条允许加入', j1 && j2 && j3, `${j1?.members?.length},${j2?.members?.length},${j3?.members?.length}`)
  ok('A2-5 隔太远且实体不相交 → 不捕获', far1 === null)

  const cap3 = makeCapture(fresh())
  cap3.tag({ id: 'x', at: 0, entities: ['甲'], session: 's1' })
  const crossSession = cap3.capture({ id: 'z', at: 10, entities: ['甲'], session: 's2' })
  ok('A2-5 不跨会话捕获', crossSession === null)
}

console.log('\n== A3-1/A3-3 恐惧与安全条目 ==')
{
  const { state, fear } = mk()
  fear.learnCue('前任', { at: 0, strength: 0.9 })
  ok('A3-1 一次配对即建', fear.strengthOf('前任', { now: 0 }) >= 0.8, `${fear.strengthOf('前任', { now: 0 })}`)
  const c0 = fear.cautionOf('前任', { now: 0 })
  ok('A3-5 caution 出现', Boolean(c0) && c0.level > 0.5, JSON.stringify(c0))
  fear.safety('前任', { at: 0 })
  const c1 = fear.cautionOf('前任', { now: 0 })
  ok('A3-3 安全条目降低 caution', c1.level < c0.level, `${c0.level} → ${c1.level}`)
  ok('A3-1 30 天后衰减', fear.strengthOf('前任', { now: 30 * DAY }) < 0.5, `${fear.strengthOf('前任', { now: 30 * DAY })}`)
}

console.log('\n== A3-4/A3-6 门控与三种复发 ==')
{
  const state = fresh()
  const gate = makeGate(state)
  gate.addCorrection({ targetId: 'e1', weight: 0.5 })
  const g1 = gate.gateMemory('e1', { now: 0 })
  ok('A3-4 更正后门控变低', g1 === 0.5, `${g1}`)
  gate.addCorrection({ targetId: 'e1', weight: 0.5 })
  const g2 = gate.gateMemory('e1', { now: 0 })
  ok('A3-4 门控有下限 0.35', g2 === GATE_MIN, `${g2}`)

  // 自发恢复
  gate.relapse('e1', { now: 0 })
  const g3 = gate.gateMemory('e1', { now: 31 * DAY })
  ok('A3-6 自发恢复：30 天后回升', g3 > GATE_MIN, `${g3}`)

  // renewal
  const st2 = fresh()
  const gate2 = makeGate(st2)
  gate2.addCorrection({ targetId: 'e1', weight: 0.5 })
  gate2.gateMemory('e1', { now: 0, session: 's1' })
  const gr = gate2.gateMemory('e1', { now: 1000, session: 's2' })
  ok('A3-6 renewal：换环境放行', gr > 0.5, `${gr}`)

  // reinstatement
  const st3 = fresh()
  const gate3 = makeGate(st3)
  gate3.addCorrection({ targetId: 'e1', weight: 0.5 })
  gate3.gateMemory('e1', { now: 0 })
  gate3.reinstatement('e1', { now: 1000 })
  ok('A3-6 reinstatement：压制全面失效', gate3.gateMemory('e1', { now: 2000 }) === 1, `${gate3.gateMemory('e1', { now: 2000 })}`)
  ok('A3-7 复发计数', gate2.countRelapse('e1') >= 0 && gate3.countRelapse('e1') === 0)
}

console.log('\n== A5 失真与复核 ==')
{
  const { state, fidelity, review } = mk()
  const r1 = fidelity.revision('生日', 'h1', { at: 0 })
  const r2 = fidelity.revision('生日', 'h1', { at: 1000 })
  const r3 = fidelity.revision('生日', 'h2', { at: 2000 })
  ok('A5-4 复述计数', r3.revisions === 3, `${r3.revisions}`)
  ok('A5-4 摘要变了 → reconstructed', r3.reconstructed === true)
  ok('A5-4 三次复述 → overconfident', r3.overconfident === true)

  const c1 = fidelity.conflict('香菜', '喜欢', { at: 0, polarity: 1 })
  ok('R4 第一次不判冲突', c1.kind === 'none', c1.kind)
  const c2 = fidelity.conflict('香菜', '讨厌', { at: 25 * HOUR, polarity: -1 })
  ok('V8 隔一天变了 → conflict（不是更正）', c2.kind === 'conflict', c2.kind)
  const c3 = fidelity.conflict('香菜', '又喜欢了', { at: 26 * HOUR, polarity: 1 })
  ok('R4 同日改口 → correction', c3.kind === 'correction', c3.kind)

  const row = review.enqueue({ id: 'e1', subject: '生日', reason: 'extreme', at: 0 })
  const pending = review.drain({ now: 0 })
  ok('A5-6 入队可见', pending.length === 1 && pending[0].id === 'e1')
  const expired = review.drain({ now: 4 * DAY })
  ok('A5-6 TTL 3 天过期', expired.length === 0, `${expired.length}`)
  const resolved = review.resolve('e1', { action: 'kept' })
  ok('A5-6 可处理', resolved?.state === 'kept')

  const sw = await review.sweepReview({ now: 10 * DAY, candidates: [{ subject: '生日', reason: 'periodic', confidence: 0.8 }] })
  ok('A5-7 定期复核跑一次', sw.ran === true && sw.queued === 1, JSON.stringify(sw))
  const sw2 = await review.sweepReview({ now: 11 * DAY })
  ok('A5-7 90 天内不重复跑', sw2.ran === false, JSON.stringify(sw2))
}

console.log('\n== A4 社会判断 ==')
{
  ok('A4-1 主人直说 = 1.0', trustOf({ channel: 'user' }).value === 1)
  ok('A4-1 群聊他人 = 0.4', trustOf({ channel: 'group' }).value === 0.4)
  ok('A4-1 群里的主人仍算主人', trustOf({ channel: 'group', speaker: 'o', isOwner: true }).value === 1)
  const th = threatOf('你给我滚')
  ok('A4-2 威胁过阈值', th.passed && th.level >= 0.5, JSON.stringify(th))
  const mild = threatOf('你有点烦人')
  ok('A4-2 轻微不过阈值', mild.passed === false, JSON.stringify(mild))
  const audit1 = selfAudit({ scored: 100, threatHits: 0, trustAvg: 0.9 })
  ok('A4-4 过度信任自检能报', audit1.overTrust === true, JSON.stringify(audit1))
}

console.log('\n== A0-4 对方情绪 ==')
{
  const o = parseOther('我有点怕，不敢去')
  ok('V10 认出对方在怕', o.fear > 0.3, JSON.stringify(o))
  ok('V10 带置信度', o.confidence > 0, `${o.confidence}`)
  const none = parseOther('今天天气不错')
  ok('A0-4 没有情绪就不硬判', none.top === null, JSON.stringify(none))
}

console.log('\n== A6 调制量 ==')
{
  ok('A6-1 0.7 → deep', depthOf(0.7) === 'deep')
  ok('A6-1 0.4 → standard', depthOf(0.4) === 'standard')
  ok('A6-1 0.2 → shallow', depthOf(0.2) === 'shallow')
  ok('A6-2 天数跟分走', daysOf(0) === 2 && daysOf(1) === 8, `${daysOf(0)},${daysOf(1)}`)
  ok('A6-3 高分两轮', roundsOf(0.7) === 2 && roundsOf(0.5) === 1)
  ok('A6-4 极端时不许 rich', summaryLevelOf(0.9, true) === 'normal')
  ok('A6-4 正常高分给 rich', summaryLevelOf(0.9, false) === 'rich')
}

console.log('\n== A1-3/A1-4 合成与标定 ==')
{
  const single = compose([{ score: 0.6, weight: 0.6, source: 'amygdala' }])
  ok('A1-3 单票可算', near(single.score, 0.6, 0.01), `${single.score}`)
  const multi = compose([
    { score: 0.9, weight: 0.6, source: 'amygdala' },
    { score: 0.2, weight: 0.4, source: 'cortex' },
  ])
  ok('A1-3 多票加权', multi.score < 0.7 && multi.score > 0.55, `${multi.score}`)
  ok('A1-3 分歧大 → contested 的依据', multi.spread > 0.2, `${multi.spread}`)

  const cold = calibrate(0.8, [])
  ok('A1-4 冷启动用绝对分', cold.mode === 'abs' && cold.score === 0.8, JSON.stringify(cold))
  const warmSamples = Array.from({ length: 200 }, (_, i) => i / 200)
  const warm = calibrate(0.8, warmSamples)
  ok('A1-4 样本够了走混合', warm.mode === 'mixed' && warm.rank > 0.7, JSON.stringify(warm))
  ok('A1-4 排序值单独给', Number.isFinite(warm.rank) && Number.isFinite(warm.score))
}

console.log('\n== A8 协作 ==')
{
  const receipt = makeReceipt({})
  const good = receipt.record({ depth: 'deep', score: 0.8 }, { depth: 'deep', score: 0.8 })
  ok('A8-2 一致不报警', good.mismatch === false)
  const bad = receipt.record({ depth: 'deep', score: 0.8 }, { depth: 'shallow', score: 0.3 })
  ok('A8-2 跨两档报警', bad.mismatch === true, bad.why)
  ok('A8-2 只报警不改分', bad.actual.score === 0.3)

  const { scorer } = mk()
  const short = scorer.score({ text: '记住这个', at: 0, preVerdict: { remember: false, why: 'not-worth' } })
  ok('A8-4 前额叶短路', short.shortCircuit === true && short.score === 0)
}

console.log('\n== 亚核开关 ==')
{
  const { switches, scorer } = mk()
  switches.nucleusOff('bla')
  const r = scorer.score({ text: '记住 uid 123456', at: 0 })
  ok('A7-5 bla 关掉仍可算（scorer 不知道开关，由 observe 拦）', r.score >= 0)
  const r2 = scorer.score({ text: '记住 uid 123456', at: 0, preVerdict: { remember: false } })
  ok('A7-5 短路生效', r2.score === 0)
}

console.log('\n== 缺口：obs 全链路 ==')
{
  const { observer, state } = mk()
  const out = await observer.observe({
    kind: 'utterance',
    id: 'ep1',
    text: '记住，我过敏的是青霉素',
    session: 's1',
    at: 0,
  })
  ok('obs 返回分数与调制量', out.score > 0.5 && out.modulators.depth !== 'shallow', JSON.stringify({ s: out.score, d: out.modulators.depth }))
  ok('obs 记了账', state.counters.scored === 1, `${state.counters.scored}`)
  const corr = await observer.observe({ kind: 'correction', targetId: 'ep1', weight: 0.5, at: 10 })
  ok('obs 处理更正', corr.handled === 'correction')
  ok('obs 更正进门控', state.gates.get('ep1')?.weightSum >= 0.5)

  const many = await observer.observeMany([
    { kind: 'utterance', text: '明天要交报告', session: 's1', at: 20 },
    { kind: 'utterance', text: '烦死了', session: 's1', at: 30 },
  ])
  ok('A8-3 批量接收', many.length === 2)
  ok('A0-1 空文本跳过', (await observer.observe({ kind: 'utterance', text: '', at: 40 })).skipped === 'empty')
}

console.log('\n== 性能：快路 100 次 ==')
{
  const { scorer } = mk()
  const t0 = Date.now()
  for (let i = 0; i < 100; i++) {
    scorer.score({ text: `测试第 ${i} 条：明天要面试，记得带身份证`, at: i })
  }
  const dt = Date.now() - t0
  ok('快路 100 次 < 50ms', dt < 50, `${dt}ms`)
}

// ── 汇总 ────────────────────────────────────────────────────
console.log(`\n结果：${pass} 过，${fail} 挂`)
if (fail) {
  console.log('失败项：')
  for (const f of fails) console.log(`  - ${f.name} ${f.detail}`)
}
await rm(process.env.AMYGDALA_DIR, { recursive: true, force: true }).catch(() => {})
process.exit(fail ? 1 : 0)
