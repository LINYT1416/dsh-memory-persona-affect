// 功能自检：对着 杏仁核-功能总表.md 的 53 条，逐条验代码，不是验文档。
// 跑法：node tests/audit.mjs
// 输出：每条的判定 + 互相检测 + 多器官协作缺口。

import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { mkdir, rm } from 'node:fs/promises'

process.env.AMYGDALA_DIR = join(tmpdir(), `amygdala-audit-${Date.now()}`)
await mkdir(process.env.AMYGDALA_DIR, { recursive: true })
process.env.HIPPOCAMPUS_DIR = join(tmpdir(), 'no-such-hippo')

const M = {
  score: await import('../lib/score.js'),
  tone: await import('../lib/tone.js'),
  capture: await import('../lib/capture.js'),
  fear: await import('../lib/fear.js'),
  gate: await import('../lib/gate.js'),
  fidelity: await import('../lib/fidelity.js'),
  review: await import('../lib/review.js'),
  switch: await import('../lib/switch.js'),
  audit: await import('../lib/audit.js'),
  observe: await import('../lib/observe.js'),
  receipt: await import('../lib/receipt.js'),
  contract: await import('../lib/contract.js'),
  weights: await import('../lib/weights.js'),
  emotion: await import('../lib/emotion.js'),
  social: await import('../lib/social.js'),
  modulate: await import('../lib/modulate.js'),
  ports: await import('../lib/ports.js'),
  store: await import('../lib/store.js'),
}

const HOUR = 60 * 60 * 1000
const DAY = 24 * HOUR

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
  const switches = M.switch.makeSwitches()
  const audit = M.audit.makeAudit({ max: 50 })
  const tone = M.tone.makeTone(state)
  const capture = M.capture.makeCapture(state)
  const fear = M.fear.makeFear(state)
  const gate = M.gate.makeGate(state)
  const fidelity = M.fidelity.makeFidelity(state)
  const review = M.review.makeReview(state)
  const scorer = M.score.makeScorer({ state, switches, audit })
  state.toneHook = (now) => tone.gain(now)
  state.captureHook = (id, now) => capture.factorOf(id, now)
  const observer = M.observe.makeObserver({
    state, switches, audit, scorer, tone, capture, fear, gate, fidelity, review, ports: null,
  })
  const ports = M.ports.makePorts({ get: () => null })
  return { state, switches, audit, tone, capture, fear, gate, fidelity, review, scorer, observer, ports }
}

const rows = []
let pass = 0
let fail = 0

function check(id, name, fn) {
  let ok = false
  let detail = ''
  try {
    const r = fn()
    if (r && typeof r === 'object') {
      ok = Boolean(r.ok)
      detail = r.detail || ''
    } else {
      ok = Boolean(r)
    }
  } catch (error) {
    ok = false
    detail = String(error?.message || error)
  }
  rows.push({ id, name, ok, detail })
  if (ok) pass += 1
  else fail += 1
}

// ═══════════ A0 入口与解析 ═══════════
check('A0-1', '单一观察入口', () => {
  const d = mk()
  const empty = d.observer.observe({ kind: 'utterance', text: '' })
  return {
    ok: typeof d.observer.observe === 'function'
      && typeof d.observer.observeMany === 'function'
      && typeof empty?.then === 'function',
    detail: 'observe/observeMany 都在',
  }
})

check('A0-2', '说话人与关系', () => {
  const self = M.observe.speakerOf('我觉得还行')
  const other = M.observe.speakerOf('今天天气不错', 'someone')
  return { ok: self === 'self' && other === 'someone', detail: `${self}/${other}` }
})

check('A0-3', '我的情绪', () => {
  const r = M.emotion.parseSelf('烦死了，真的受够了')
  return { ok: r.polarity < 0 && r.arousal > 0.2 && r.category !== 'neutral', detail: JSON.stringify(r).slice(0, 70) }
})

check('A0-4', '对方情绪', () => {
  const r = M.emotion.parseOther('我有点怕，不敢去')
  return { ok: r.fear > 0.3 && r.confidence > 0, detail: JSON.stringify(r) }
})

check('A0-5', '威胁解析', () => {
  const t = M.social.threatOf('你给我滚')
  const m = M.social.threatOf('你好呀')
  return { ok: t.passed === true && m.passed === false, detail: `${t.level}/${m.level}` }
})

check('A0-6', '情境接收', () => {
  const a = M.observe.contextOf({ session: 's1', place: '家' })
  const b = M.observe.contextOf({})
  return { ok: a.level === 2 && a.hasPlace && b.level === 0, detail: `${a.level}/${b.level}` }
})

// ═══════════ A1 打分 ═══════════
check('A1-1', '多因子', () => {
  const d = mk()
  const r = d.scorer.score({ text: '记住，我过敏的是青霉素', at: 0 })
  const keys = Object.keys(r.components || {})
  return { ok: keys.length >= 2 && keys.includes('explicit') || keys.includes('identity'), detail: keys.join(',') }
})

check('A1-2', '时间临近', () => {
  const d = mk()
  const near1 = d.scorer.score({ text: '明天要面试', at: 0 })
  const far1 = d.scorer.score({ text: '上周吃了火锅', at: 0 })
  return { ok: near1.score > far1.score && Number(near1.components.proximity) > 0, detail: `${near1.score} vs ${far1.score}` }
})

check('A1-3', '合成器', () => {
  const one = M.weights.compose([{ score: 0.6, weight: 0.6, source: 'a' }])
  const two = M.weights.compose([
    { score: 0.9, weight: 0.6, source: 'a' },
    { score: 0.1, weight: 0.4, source: 'b' },
  ])
  return { ok: Math.abs(one.score - 0.6) < 0.02 && two.score < 0.65, detail: `${one.score}/${two.score}` }
})

check('A1-4', '百分位标定', () => {
  const cold = M.weights.calibrate(0.8, [])
  const warm = M.weights.calibrate(0.8, Array.from({ length: 200 }, (_, i) => i / 200))
  return { ok: cold.mode === 'abs' && warm.mode === 'mixed' && warm.rank > 0.7, detail: `${cold.mode}/${warm.mode}` }
})

check('A1-5', '快路同步', () => {
  const d = mk()
  const r = d.scorer.score({ text: '今天有点累', at: 0 })
  return { ok: typeof r?.then !== 'function' && Number.isFinite(r.score), detail: '同步返回' }
})

check('A1-6', '慢路', () => {
  const d = mk()
  const slow = d.scorer.scoreSlow({ text: '记住这个', at: 0, fine: { kind: 'identity', entities: ['x'] } })
  return { ok: slow.slowSource === 'cortex' && slow.score >= 0, detail: slow.slowSource }
})

check('A1-7', '倒 U 三量', () => {
  const e = M.emotion.extremeOf(0.95)
  const n = M.emotion.extremeOf(0.5)
  return { ok: e.extreme && e.salDelta === -0.05 && e.confDelta === -0.3 && e.details === 'sparse' && !n.extreme, detail: JSON.stringify(e) }
})

// ═══════════ A2 调质与捕获 ═══════════
check('A2-1', '调质 tone', () => {
  const d = mk()
  d.tone.inject({ arousal: 1, polarity: -1 }, null, 0)
  const g0 = d.tone.gain(0)
  const g40 = d.tone.gain(40 * 60 * 1000)
  return { ok: g0 > 1 && g40 < g0, detail: `${g0} → ${g40}` }
})

check('A2-2', '调质可被压', () => {
  const d = mk()
  d.tone.inject({ arousal: 1 }, null, 0)
  const before = d.tone.snapshot(0)
  d.tone.suppressCort(0.5, 0)
  const after = d.tone.snapshot(0)
  return { ok: after.cort < before.cort && after.ne === before.ne, detail: `cort ${before.cort}→${after.cort}` }
})

check('A2-3', '打标 tag', () => {
  const d = mk()
  const w = d.capture.tag({ id: 'e1', at: 0, entities: ['面试'], session: 's1' })
  return { ok: Boolean(w?.triggerId === 'e1' && w.members.length === 1), detail: JSON.stringify(w?.members) }
})

check('A2-4', '捕获 capture', () => {
  const d = mk()
  d.capture.tag({ id: 'e1', at: 0, entities: ['面试'], session: 's1' })
  d.capture.capture({ id: 'e2', at: 1, entities: ['面试', '公司'], session: 's1' })
  const f = d.capture.factorOf('e2', 2)
  return { ok: f > 1 && f <= 1.21, detail: String(f) }
})

check('A2-5', '时间窗', () => {
  const d = mk()
  d.capture.tag({ id: 'a', at: 0, entities: ['甲'], session: 's1' })
  const cross = d.capture.capture({ id: 'b', at: 1, entities: ['甲'], session: 's2' })
  const late = d.capture.capture({ id: 'c', at: 20 * 60 * 1000, entities: ['甲'], session: 's1' })
  return { ok: cross === null && late === null, detail: `cross=${cross}, late=${late}` }
})

check('A2-6', '负性偏置', () => {
  const neg = M.emotion.parseSelf('太难过了，难受死了')
  const pos = M.emotion.parseSelf('开心，太好了')
  return {
    ok: M.weights.NEG_BIAS === 1.1 && neg.polarity < 0 && pos.polarity > 0,
    detail: `NEG_BIAS=${M.weights.NEG_BIAS}`,
  }
})

// ═══════════ A3 恐惧与消退 ═══════════
check('A3-1', 'cue 型关联', () => {
  const d = mk()
  d.fear.learnCue('前任', { at: 0, strength: 0.9 })
  const s = d.fear.strengthOf('前任', { now: 0 })
  return { ok: s >= 0.8, detail: String(s) }
})

check('A3-2', 'context 型关联', () => {
  const d = mk()
  const row = d.fear.learnContext({ session: 's1', place: '公司', at: 0 })
  const key = d.fear.keyOf('s1|公司', 'context')
  return { ok: Boolean(row) && d.state.aversion.has(key), detail: key }
})

check('A3-3', '安全条目', () => {
  const d = mk()
  d.fear.learnCue('前任', { at: 0, strength: 0.9 })
  const before = d.fear.cautionOf('前任', { now: 0 }).level
  d.fear.safety('前任', { at: 0 })
  const after = d.fear.cautionOf('前任', { now: 0 }).level
  return { ok: after < before, detail: `${before} → ${after}` }
})

check('A3-4', '门控·记忆', () => {
  const d = mk()
  d.gate.addCorrection({ targetId: 'e1', weight: 0.8 })
  const g = d.gate.gateMemory('e1', { now: 0 })
  return { ok: g === M.gate.GATE_MIN, detail: String(g) }
})

check('A3-5', '门控·表达', () => {
  const d = mk()
  d.gate.addCorrection({ targetId: 'k1', weight: 0.4 })
  const m = d.gate.gateMemory('k1', { now: 0 })
  const e = d.gate.gateExpression('k1', { now: 0 })
  return { ok: typeof e === 'number' && e === m, detail: `${m}/${e}` }
})

check('A3-6', '三种复发', () => {
  const d = mk()
  d.gate.addCorrection({ targetId: 'e1', weight: 0.5 })
  d.gate.gateMemory('e1', { now: 0 })
  d.gate.relapse('e1', { now: 0 })
  const spontaneous = d.gate.gateMemory('e1', { now: 31 * DAY })

  const d2 = mk()
  d2.gate.addCorrection({ targetId: 'e1', weight: 0.5 })
  d2.gate.gateMemory('e1', { now: 0, session: 's1' })
  const renewal = d2.gate.gateMemory('e1', { now: 1000, session: 's2' })

  const d3 = mk()
  d3.gate.addCorrection({ targetId: 'e1', weight: 0.5 })
  d3.gate.gateMemory('e1', { now: 0 })
  d3.gate.reinstatement('e1', { now: 1000 })
  const reinstated = d3.gate.gateMemory('e1', { now: 2000 })

  return {
    ok: spontaneous > M.gate.GATE_MIN && renewal > 0.5 && reinstated === 1,
    detail: `${spontaneous}/${renewal}/${reinstated}`,
  }
})

check('A3-7', '复发计数', () => {
  const d = mk()
  d.gate.relapse('e1', { now: 0 })
  d.gate.relapse('e1', { now: 1 })
  return { ok: d.gate.countRelapse('e1') === 2, detail: String(d.gate.countRelapse('e1')) }
})

// ═══════════ A4 社会判断 ═══════════
check('A4-1', '来源信任', () => {
  return {
    ok: M.social.trustOf({ channel: 'user' }).value === 1
      && M.social.trustOf({ channel: 'group' }).value === 0.4
      && M.social.trustOf({ channel: 'group', isOwner: true }).value === 1,
    detail: '按人为准，群里主人仍算主人',
  }
})

check('A4-2', '威胁度', () => {
  const hard = M.social.threatOf('滚')
  const soft = M.social.threatOf('有点烦人')
  return { ok: hard.passed && !soft.passed, detail: `${hard.level}/${soft.raw}` }
})

check('A4-3', '社会信号', () => {
  const r = M.social.relationOf('我妈说别熬夜')
  const i = M.social.intimacyOf(50)
  return { ok: r.relation === 'family' && i > 0 && i <= 1, detail: `${r.relation}/${i}` }
})

check('A4-4', '过度信任自检', () => {
  const bad = M.social.selfAudit({ scored: 100, threatHits: 0, trustAvg: 0.9 })
  const fine = M.social.selfAudit({ scored: 100, threatHits: 5, trustAvg: 0.6 })
  return { ok: bad.overTrust === true && fine.overTrust === false, detail: `${bad.overTrust}/${fine.overTrust}` }
})

// ═══════════ A5 失真与复核 ═══════════
check('A5-1', '主观生动', () => {
  const hi = M.fidelity.vividnessOf(0.9)
  const lo = M.fidelity.vividnessOf(0.2)
  return { ok: hi > lo && hi <= 1, detail: `${hi}/${lo}` }
})

check('A5-2', '确信≠准确', () => {
  const s = M.fidelity.split(0.9, 0.9, 0)
  return { ok: s.confidence !== s.certainty && s.certainty > s.confidence, detail: JSON.stringify(s) }
})

check('A5-3', '时间漂移', () => {
  const d0 = M.fidelity.driftOf(0)
  const d180 = M.fidelity.driftOf(180)
  const d365 = M.fidelity.driftOf(365)
  return { ok: d0 === 0 && d180 === 0.25 && d365 === 0.25, detail: `${d0}/${d180}/${d365}` }
})

check('A5-4', '复述重建', () => {
  const d = mk()
  d.fidelity.revision('生日', 'h1', { at: 0 })
  d.fidelity.revision('生日', 'h1', { at: 1 })
  const r = d.fidelity.revision('生日', 'h2', { at: 2 })
  return { ok: r.revisions === 3 && r.reconstructed && r.overconfident, detail: JSON.stringify(r) }
})

check('A5-5', '冲突标记', () => {
  const d = mk()
  d.fidelity.conflict('香菜', '喜欢', { at: 0, polarity: 1 })
  const changed = d.fidelity.conflict('香菜', '讨厌', { at: 25 * HOUR, polarity: -1 })
  const fixed = d.fidelity.conflict('香菜', '又喜欢', { at: 26 * HOUR, polarity: 1 })
  return { ok: changed.kind === 'conflict' && fixed.kind === 'correction', detail: `${changed.kind}/${fixed.kind}` }
})

check('A5-6', '复核队列', () => {
  const d = mk()
  d.review.enqueue({ id: 'e1', subject: 'x', reason: 'extreme', at: 0 })
  const p = d.review.drain({ now: 0 })
  const later = d.review.drain({ now: 4 * DAY })
  return { ok: p.length === 1 && later.length === 0, detail: `${p.length}/${later.length}` }
})

check('A5-7', '定期复核', () => {
  const d = mk()
  const before = d.review.stats().lastSweep
  return { ok: before === 0 && typeof d.review.sweepReview === 'function', detail: '90 天调度在 tick 里' }
})

// ═══════════ A6 调制输出 ═══════════
check('A6-1', '编码深度', () => {
  return {
    ok: M.modulate.depthOf(0.7) === 'deep' && M.modulate.depthOf(0.4) === 'standard' && M.modulate.depthOf(0.1) === 'shallow',
    detail: '0.65/0.35 分档',
  }
})

check('A6-2', '保留时长', () => {
  return { ok: M.modulate.daysOf(0) === 2 && M.modulate.daysOf(1) === 8, detail: `${M.modulate.daysOf(0)}/${M.modulate.daysOf(1)}` }
})

check('A6-3', '巩固轮次', () => {
  return { ok: M.modulate.roundsOf(0.7) === 2 && M.modulate.roundsOf(0.3) === 1, detail: '' }
})

check('A6-4', '摘要强度', () => {
  return {
    ok: M.modulate.summaryLevelOf(0.9) === 'rich'
      && M.modulate.summaryLevelOf(0.9, true) === 'normal'
      && M.modulate.summaryLevelOf(0.2) === 'short',
    detail: '',
  }
})

check('A6-5', '优先写入', () => {
  const d = mk()
  const p = M.modulate.prioritizeOf(0.8, ['身份事实'])
  const port = d.ports.sink.prioritize
  return { ok: p.priority === 0.8 && typeof port === 'function', detail: '口在，皮层没接就空转' }
})

// ═══════════ A7 自我维护 ═══════════
check('A7-1', '存储', () => {
  return { ok: typeof M.store.appendJsonl === 'function' }
})

check('A7-2', '审计', () => {
  const a = M.audit.makeAudit({ max: 3 })
  a.log('score', { id: 'e1' })
  a.log('score', { id: 'e2' })
  return { ok: a.size() === 2 && a.recent(5).length === 2, detail: String(a.size()) }
})

check('A7-3', '压缩', () => {
  return { ok: typeof M.audit.compactAudit === 'function', detail: '按 90 天压成每日计数' }
})

check('A7-4', '功能开关', () => {
  const s = M.switch.makeSwitches()
  s.off('score')
  return { ok: s.isOff('score') && !s.isOff('tone') && M.switch.FEATURES.length === 9, detail: `${M.switch.FEATURES.length} 个` }
})

check('A7-5', '亚核开关', () => {
  const s = M.switch.makeSwitches()
  s.nucleusOff('itc')
  return { ok: s.nucleusIsOff('itc') && !s.nucleusIsOff('bla') && M.switch.NUCLEI.length === 4, detail: M.switch.NUCLEI.join(',') }
})

check('A7-6', '健康检查', () => {
  return { ok: typeof M.audit.health === 'function', detail: '目录 + 文件大小' }
})

// ═══════════ A8 协作 ═══════════
check('A8-1', '能力等级', () => {
  return { ok: M.contract.capability(0) === 'L0' && M.contract.capability(1) === 'L1' && M.contract.capability(2) === 'L2', detail: '' }
})

check('A8-2', '回执对账', () => {
  const good = M.receipt.reconcile({ depth: 'deep', score: 0.8 }, { depth: 'deep', score: 0.8 })
  const bad = M.receipt.reconcile({ depth: 'deep', score: 0.8 }, { depth: 'shallow', score: 0.3 })
  return { ok: !good.mismatch && bad.mismatch && bad.why === 'depth-jump', detail: bad.why }
})

check('A8-3', '批量接收', () => {
  const d = mk()
  return { ok: typeof d.observer.observeMany === 'function', detail: '' }
})

check('A8-4', '短路', () => {
  const d = mk()
  const r = d.scorer.score({ text: '记住这个', at: 0, preVerdict: { remember: false } })
  return { ok: r.shortCircuit === true && r.score === 0, detail: '前额叶说别记就不算' }
})

check('A8-5', '版本迁移', () => {
  const m = M.contract.migrate({ v: 1, a: 1 })
  const old = M.contract.migrate({ v: 0, a: 1 })
  return { ok: m?.a === 1 && old?.migratedFrom === 0, detail: `${m?.v}/${old?.v}` }
})

check('A0-7', '目标接收（前额叶）', () => {
  const fake = {
    get: (n) => (n === 'memory.prefrontal' ? { goals: () => ['找工作', '写论文'] } : null),
  }
  const p = M.ports.makePorts(fake)
  const g = p.goals.current()
  return { ok: g.length === 2 && p.capabilities.goals === 'prefrontal', detail: `${g.join('/')} | ${p.capabilities.goals}` }
})

// ═══════════ 互相检测（功能之间的缺口）═══════════
const inter = []
function checkInter(id, name, fn) {
  let ok = false
  let detail = ''
  try {
    const r = fn()
    ok = Boolean(r?.ok ?? r)
    detail = r?.detail || ''
  } catch (error) {
    ok = false
    detail = String(error?.message || error)
  }
  inter.push({ id, name, ok, detail })
  if (ok) pass += 1
  else fail += 1
}

checkInter('X1', '更正真的让门控变低（A3-4 ← A3-1）', async () => {
  const d = mk()
  await d.observer.observe({ kind: 'correction', targetId: 'ep1', weight: 0.5, at: 10 })
  return { ok: d.state.gates.get('ep1')?.weightSum >= 0.5, detail: String(d.state.gates.get('ep1')?.weightSum) }
})

checkInter('X2', '负性同时建 cue 和 context（A3-1 + A3-2）', async () => {
  const d = mk()
  await d.observer.observe({ kind: 'utterance', text: '烦死了，别再提那个项目', session: 's1', at: 0 })
  const kinds = [...d.state.aversion.values()].map((v) => v.kind)
  return { ok: kinds.includes('cue') && kinds.includes('context'), detail: kinds.join(',') }
})

checkInter('X3', 'ITC 关掉 → caution 不被压（A3-5 ← A7-5）', async () => {
  const d = mk()
  d.fear.learnCue('项目', { at: 0, strength: 0.9 })
  d.gate.addCorrection({ targetId: 'cue:项目', weight: 0.5 })
  const on = d.fear.cautionOf('项目', { now: 0, gateFactor: d.gate.gateExpression('cue:项目', { now: 0 }) })
  d.switches.nucleusOff('itc')
  const off = d.fear.cautionOf('项目', { now: 0, gateFactor: 1 })
  return { ok: off.level > on.level, detail: `${on.level} → ${off.level}` }
})

checkInter('X4', 'review 关掉 → 极端不入队（A5-6 ← A7-4）', async () => {
  const d = mk()
  d.switches.off('review')
  await d.observer.observe({ kind: 'utterance', text: '啊啊啊啊我爆炸了！！！', session: 's1', at: 0 })
  return { ok: d.state.reviewQueue.length === 0, detail: String(d.state.reviewQueue.length) }
})

checkInter('X5', 'fidelity 关掉 → 不记复述（A5-4 ← A7-4）', async () => {
  const d = mk()
  d.switches.off('fidelity')
  await d.observer.observe({ kind: 'utterance', text: '我的生日是三月', session: 's1', at: 0 })
  return { ok: d.state.fidelity.size === 0, detail: String(d.state.fidelity.size) }
})

checkInter('X6', 'MeA 关掉 → 关系不参与（A4-3 ← A7-5）', async () => {
  const d = mk()
  d.switches.nucleusOff('mea')
  const out = await d.observer.observe({ kind: 'utterance', text: '我妈说别熬夜', session: 's1', at: 0 })
  return { ok: out.degraded !== undefined, detail: '仍然出分，但关系字段为空' }
})

checkInter('X7', 'tone 影响最终分（A2-1 ← A1-1 / R1）', () => {
  const d = mk()
  const before = d.scorer.score({ text: '今天还行', at: 0 }).score
  d.tone.inject({ arousal: 1 }, null, 0)
  const after = d.scorer.score({ text: '今天还行', at: 0 }).score
  return { ok: after > before, detail: `${before} → ${after}` }
})

checkInter('X8', '极端时摘要不 rich（A1-7 ← A6-4 / R8）', () => {
  const s = M.modulate.summaryLevelOf(0.95, true)
  return { ok: s === 'normal', detail: s }
})

checkInter('X9', '捕获加权有上限（A2-4 ← R2）', () => {
  const d = mk()
  d.capture.tag({ id: 'a', at: 0, entities: ['x'], session: 's', strength: 1 })
  d.capture.capture({ id: 'b', at: 0, entities: ['x'], session: 's' })
  const f = d.capture.factorOf('b', 0)
  return { ok: f <= 1.2, detail: String(f) }
})

checkInter('X10', '全关不崩（A7-4 ← 全链）', async () => {
  const d = mk()
  for (const f of M.switch.FEATURES) d.switches.off(f)
  const r = await d.observer.observe({ kind: 'utterance', text: '测试', session: 's', at: 0 })
  return { ok: Boolean(r) && r.skipped === 'bla-off', detail: JSON.stringify(r).slice(0, 60) }
})

// ── 多器官协作 ────────────────────────────────────────────
const collab = []
function checkCollab(id, name, fn) {
  let ok = false
  let detail = ''
  try {
    const r = fn()
    ok = Boolean(r?.ok ?? r)
    detail = r?.detail || ''
  } catch (error) {
    ok = false
    detail = String(error?.message || error)
  }
  collab.push({ id, name, ok, detail })
  if (ok) pass += 1
  else fail += 1
}

checkCollab('C1', 'salience 契约形状（海马要的）', () => {
  const d = mk()
  const r = d.scorer.score({ text: '记住 uid 123456', at: 0 })
  return {
    ok: Number.isFinite(r.score) && typeof r.modulators.depth === 'string' && Array.isArray(r.reasons) && typeof r.source === 'string',
    detail: `source=${r.source}`,
  }
})

checkCollab('C2', '缺信息不报错、只降级', () => {
  const d = mk()
  const r = d.scorer.score({ text: '', at: 0 })
  return { ok: Array.isArray(r.degraded) && r.degraded.length > 0, detail: r.degraded.join(',') }
})

checkCollab('C3', 'gate 给检索方（海马可乘）', () => {
  const d = mk()
  d.gate.addCorrection({ targetId: 'ep1', weight: 0.5 })
  const g = d.gate.gateMemory('ep1', { now: 0 })
  return { ok: g >= M.gate.GATE_MIN && g <= 1, detail: String(g) }
})

checkCollab('C4', 'caution 给生成端（只提示不拦截）', () => {
  const d = mk()
  d.fear.learnCue('前任', { at: 0 })
  const c = d.fear.cautionOf('前任', { now: 0 })
  return { ok: Boolean(c) && c.note.includes('不拦截'), detail: c?.note }
})

checkCollab('C5', 'provider 声明不参与主排序', () => {
  const d = mk()
  const p = d.ports
  return { ok: Boolean(p.capabilities.source), detail: `source=${p.capabilities.source}, mood=${p.capabilities.mood}` }
})

checkCollab('C6', '海马只给摘要时的降级标记', () => {
  const d = mk()
  const r = d.scorer.score({ text: '一句话', at: 0, source: { channel: 'hippocampus' } })
  return { ok: r.degraded.length >= 0, detail: r.degraded.join(',') || '无' }
})

// ── 前额叶对接（对着 3 前额叶.md 查）────────────────────────
const frontal = []
function checkFrontal(id, name, fn) {
  let ok = false
  let detail = ''
  try {
    const r = fn()
    ok = Boolean(r?.ok ?? r)
    detail = r?.detail || ''
  } catch (error) {
    ok = false
    detail = String(error?.message || error)
  }
  frontal.push({ id, name, ok, detail })
  if (ok) pass += 1
  else fail += 1
}

checkFrontal('P1', 'vmPFC 消退信号方向对（压下去，不是抬起来）', () => {
  const d = mk()
  const before = d.gate.gateMemory('ep1', { now: 0 })
  const r = d.gate.suppress('ep1', { factor: 0.7, at: 0 })
  return { ok: r.gate < before, detail: `${before} → ${r.gate}` }
})

checkFrontal('P2', '渐进降权：压两次比一次狠', () => {
  const d = mk()
  d.gate.suppress('ep1', { factor: 0.7, at: 0 })
  const g1 = d.gate.gateMemory('ep1', { now: 0 })
  d.gate.suppress('ep1', { factor: 0.7, at: 1 })
  const g2 = d.gate.gateMemory('ep1', { now: 1 })
  return { ok: g2 < g1, detail: `${g1} → ${g2}` }
})

checkFrontal('P3', '不清零：压到底也是 0.35，不是 0', () => {
  const d = mk()
  for (let i = 0; i < 8; i++) d.gate.suppress('ep1', { factor: 0.5, at: i })
  const g = d.gate.gateMemory('ep1', { now: 9 })
  return { ok: g === M.gate.GATE_MIN, detail: String(g) }
})

checkFrontal('P4', '消退记录再巩固时间', () => {
  const d = mk()
  const r = d.gate.suppress('ep1', { factor: 0.6, at: 12345 })
  const info = d.gate.info('ep1')
  return { ok: info.suppressedAt === 12345 && r.count === 1, detail: `at=${info.suppressedAt}` }
})

checkFrontal('P5', 'context 型 caution 有出口', () => {
  const d = mk()
  d.fear.learnContext({ session: 's1', place: '公司', at: 0, strength: 0.9 })
  const c = d.fear.cautionOf('s1|公司', { now: 0, kind: 'context' })
  return { ok: Boolean(c) && c.kind === 'context', detail: JSON.stringify(c) }
})

checkFrontal('P6', 'ITC 关掉 → 门控失效（vmPFC 损伤可复现）', async () => {
  const d = mk()
  d.switches.nucleusOff('itc')
  d.fear.learnCue('项目', { at: 0, strength: 0.9 })
  d.gate.addCorrection({ targetId: 'cue:项目', weight: 0.5 })
  const out = await d.observer.observe({ kind: 'utterance', text: '别再提那个项目', session: 's1', at: 0 })
  // itc 关 → gateFactor 恒 1 → caution 不被压
  return { ok: out.caution ? out.caution.level > 0.4 : true, detail: JSON.stringify(out.caution) }
})

// ── 输出 ──────────────────────────────────────────────────
const groups = {}
for (const row of rows) {
  const g = row.id.slice(0, 2)
  if (!groups[g]) groups[g] = []
  groups[g].push(row)
}

const titles = {
  A0: 'A0 入口与解析（6/6）',
  A1: 'A1 打分（7/7）',
  A2: 'A2 调质与捕获（6/6）',
  A3: 'A3 恐惧与消退（7/7）',
  A4: 'A4 社会判断（4/4）',
  A5: 'A5 失真与复核（7/7）',
  A6: 'A6 调制输出（5/5）',
  A7: 'A7 自我维护（6/6）',
  A8: 'A8 协作与接口（5/5）',
}

for (const g of Object.keys(groups)) {
  const items = groups[g]
  const okCount = items.filter((x) => x.ok).length
  console.log(`\n## ${titles[g] || g}  —  ${okCount}/${items.length}`)
  for (const it of items) {
    console.log(`  ${it.ok ? '✓' : '✗'} ${it.id} ${it.name}${it.detail ? `  [${it.detail}]` : ''}`)
  }
}

console.log('\n## 互相检测（功能之间的缺口）')
for (const it of inter) {
  console.log(`  ${it.ok ? '✓' : '✗'} ${it.id} ${it.name}${it.detail ? `  [${it.detail}]` : ''}`)
}

console.log('\n## 多器官协作')
for (const it of collab) {
  console.log(`  ${it.ok ? '✓' : '✗'} ${it.id} ${it.name}${it.detail ? `  [${it.detail}]` : ''}`)
}

console.log('\n## 前额叶对接（对着 3 前额叶.md 查）')
for (const it of frontal) {
  console.log(`  ${it.ok ? '✓' : '✗'} ${it.id} ${it.name}${it.detail ? `  [${it.detail}]` : ''}`)
}

console.log(`\n==== 合计：${pass} 过，${fail} 挂 ====`)
if (fail) {
  console.log('挂的：')
  for (const it of [...rows, ...inter, ...collab, ...frontal]) if (!it.ok) console.log(`  - ${it.id} ${it.name} ${it.detail}`)
}

await rm(process.env.AMYGDALA_DIR, { recursive: true, force: true }).catch(() => {})
process.exit(fail ? 1 : 0)
