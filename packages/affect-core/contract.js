// 契约快照（v1），抄自 packages/_contract\contract.mjs。
// 为什么抄一份：插件装进 profile 后拿不到 workspace 里的 _contract 目录。
// 规矩：这个文件只读。契约要改，先改 _contract 并升版本，再回来同步。
// 契约是宪法，不许在这个包里偷偷加字段。

export const CONTRACT_VERSION = 1

export const ORGANS = {
  'affect.amygdala': {
    pkg: 'dsh-affect-amygdala',
    phase: 1,
    produces: ['sig.threat', 'sig.rewardPE', 'sig.novelty', 'sig.salience', 'sig.tone', 'sig.alarm', 'sig.capture'],
  },
  'affect.hypothalamus': {
    pkg: 'dsh-affect-hypothalamus',
    phase: 2,
    produces: ['sig.body', 'sig.needs', 'sig.hpa', 'sig.resource', 'sig.rhythm', 'sig.autonomic'],
  },
  'affect.insula': {
    pkg: 'dsh-affect-insula',
    phase: 3,
    produces: ['sig.felt', 'sig.disgust', 'sig.resonance', 'sig.bodyBudget', 'sig.misattribution'],
  },
  'affect.hippocampus': {
    pkg: 'dsh-affect-hippocampus',
    phase: 4,
    produces: ['sig.recall.prior', 'sig.context', 'sig.rumination', 'sig.episode.closed', 'sig.schema'],
  },
  'affect.pfc': {
    pkg: 'dsh-affect-pfc',
    phase: 5,
    produces: ['sig.display', 'sig.regulate', 'sig.attribution', 'sig.pfcGain', 'sig.control', 'sig.decision', 'sig.suppression'],
  },
}

export const SIGNALS = {
  'ev.turn.user':      { from: 'core', fields: { eventId: 'string', text: 'string', at: 'number', session: 'string?' } },
  'ev.turn.assistant': { from: 'core', fields: { eventId: 'string', text: 'string', at: 'number', session: 'string?' } },
  'ev.tick':           { from: 'core', fields: { txId: 'string', t0: 'number', t1: 'number', dtMs: 'number' } },
  'ev.episode.close':  { from: 'core', fields: { episodeId: 'string', valence: 'number', intensity: 'number' } },
  'ev.scene':          { from: 'core', fields: { scene: 'string' } },
  'ev.activity':       { from: 'core', fields: { kind: 'string' } },

  'sig.threat':        { from: 'affect.amygdala', fields: { level: 'number', cueId: 'string?', scene: 'string?' } },
  'sig.rewardPE':      { from: 'affect.amygdala', fields: { delta: 'number', source: 'string?' } },
  'sig.novelty':       { from: 'affect.amygdala', fields: { level: 'number' } },
  'sig.salience':      { from: 'affect.amygdala', fields: { score: 'number', tags: 'array?' } },
  'sig.tone':          { from: 'affect.amygdala', fields: { ne: 'number', cort: 'number' } },
  'sig.alarm':         { from: 'affect.amygdala', fields: { kind: 'string', intensity: 'number' } },
  'sig.capture':       { from: 'affect.amygdala', fields: { windowMs: 'number' } },

  'sig.body':          { from: 'affect.hypothalamus', fields: { hr: 'number', hrv: 'number', breath: 'number', gut: 'number', temp: 'number', tension: 'number' } },
  'sig.needs':         { from: 'affect.hypothalamus', fields: { name: 'string', gap: 'number', urgency: 'number?' } },
  'sig.hpa':           { from: 'affect.hypothalamus', fields: { cortisol: 'number', ne: 'number' } },
  'sig.resource':      { from: 'affect.hypothalamus', fields: { bandwidthCap: 'number', fatigueRate: 'number?' } },
  'sig.rhythm':        { from: 'affect.hypothalamus', fields: { energy: 'number', moodBias: 'number', thresholdShift: 'number' } },
  'sig.autonomic':     { from: 'affect.hypothalamus', fields: { sym: 'number', par: 'number' } },

  'sig.felt':          { from: 'affect.insula', fields: { intensity: 'number', qualities: 'array', location: 'string?' } },
  'sig.disgust':       { from: 'affect.insula', fields: { level: 'number', target: 'string?' } },
  'sig.resonance':     { from: 'affect.insula', fields: { level: 'number' } },
  'sig.bodyBudget':    { from: 'affect.insula', fields: { value: 'number' } },
  'sig.misattribution':{ from: 'affect.insula', fields: { prob: 'number', suggestedSource: 'string?' } },

  'sig.recall.prior':  { from: 'affect.hippocampus', fields: { hits: 'array', bias: 'number?', confidence: 'number?' } },
  'sig.context':       { from: 'affect.hippocampus', fields: { scene: 'string', expectedValence: 'number?' } },
  'sig.rumination':    { from: 'affect.hippocampus', fields: { episodeId: 'string', urge: 'number' } },
  'sig.episode.closed':{ from: 'affect.hippocampus', fields: { id: 'string', valence: 'number', object: 'string?', scene: 'string?' } },
  'sig.schema':        { from: 'affect.hippocampus', fields: { rule: 'string', confidence: 'number' } },

  'sig.display':       { from: 'affect.pfc', fields: { mask: 'number', toneShift: 'string', brevity: 'number', leakRisk: 'number' } },
  'sig.regulate':      { from: 'affect.pfc', fields: { strategy: 'string', success: 'boolean', cost: 'number?' } },
  'sig.attribution':   { from: 'affect.pfc', fields: { locus: 'string', stability: 'string', globality: 'string', blame: 'string' } },
  'sig.pfcGain':       { from: 'affect.pfc', fields: { value: 'number' } },
  'sig.control':       { from: 'affect.pfc', fields: { bandwidth: 'number', load: 'number' } },
  'sig.decision':      { from: 'affect.pfc', fields: { speak: 'boolean', whenNow: 'boolean?', yield: 'boolean?', hold: 'boolean?' } },
  'sig.suppression':   { from: 'affect.pfc', fields: { episodeId: 'string', strength: 'number' } },

  'sig.mood':          { from: 'core', fields: { valence: 'number', arousal: 'number', source: 'string?' } },
  'sig.emotion':       { from: 'core', fields: { kind: 'string', target: 'string', intensity: 'number', mixed: 'array?' } },
  'sig.attention':     { from: 'core', fields: { focusedOn: 'array', precision: 'number' } },
  'sig.social':        { from: 'core', fields: { who: 'string', relationship: 'string', audience: 'number?' } },
  'sig.other.felt':    { from: 'core', fields: { intensity: 'number', valence: 'number' } },
  'sig.appraisal.slow':{ from: 'core', fields: { eventId: 'string', dims: 'object' } },
}

export const ERRORS = {
  E_CONTRACT: '契约不匹配（版本、id、信号名或字段）',
  E_MISSING_DEP: '依赖器官不在（降级，不是崩溃）',
  E_STATE: '状态文件损坏或不可读（应自愈，不阻塞）',
  E_LIMIT: '超出限幅（熔断，防止跑飞）',
  E_PURE: 'read() 不纯（推进了时间/写了盘/产生了随机数）',
}

export const FIELD_RANGES = {
  level: [0, 1], delta: [-1, 1], score: [0, 1], intensity: [0, 1],
  ne: [0, 1], cort: [0, 1], cortisol: [0, 1],
  hr: [40, 180], hrv: [10, 120], breath: [5, 40], gut: [-1, 1], temp: [-1, 1], tension: [0, 1],
  gap: [0, 1], urgency: [0, 1],
  bandwidthCap: [0.1, 1], energy: [0, 1], moodBias: [-1, 1], thresholdShift: [-1, 1],
  sym: [0, 1], par: [0, 1],
  mask: [0, 1], brevity: [0, 1], leakRisk: [0, 1],
  value: [0, 1], prob: [0, 1], probability: [0, 1], urge: [0, 1], similarity: [0, 1],
  valence: [-1, 1], arousal: [0, 1], precision: [0, 1],
  bandwidth: [0, 1], load: [0, 1], cap: [0, 1], fatigue: [0, 1], strength: [0, 1],
  confidence: [0, 1], weight: [0, 1],
}

const TYPE_OK = {
  string: v => typeof v === 'string',
  number: v => typeof v === 'number' && Number.isFinite(v),
  boolean: v => typeof v === 'boolean',
  array: v => Array.isArray(v),
  object: v => v !== null && typeof v === 'object',
}

export function validateOrgan(org) {
  const errors = []
  if (!org || typeof org !== 'object') return { ok: false, errors: ['器官不是对象'] }
  if (!ORGANS[org.id]) errors.push(`未知器官 id: ${org.id}`)
  if (org.contract !== CONTRACT_VERSION) errors.push(`契约版本不符: ${org.contract} != ${CONTRACT_VERSION}`)
  for (const fn of ['init', 'onHeartbeat', 'onSignal', 'snapshot', 'restore', 'read', 'health']) {
    if (typeof org[fn] !== 'function') errors.push(`缺方法 ${fn}()`)
  }
  if (!org.params || typeof org.params !== 'object') errors.push('缺 params 对象')
  return { ok: errors.length === 0, errors }
}

export function validateSignal(name, payload, { strict = true } = {}) {
  const def = SIGNALS[name]
  if (!def) {
    if (strict) return { ok: false, errors: [`未知信号 ${name}`], warn: true }
    return { ok: true, errors: [], warn: true }
  }
  const errors = []
  for (const [field, type] of Object.entries(def.fields)) {
    const optional = type.endsWith('?')
    const base = optional ? type.slice(0, -1) : type
    const v = payload?.[field]
    if (v === undefined) {
      if (!optional) errors.push(`${name} 缺字段 ${field}`)
      continue
    }
    if (!TYPE_OK[base]?.(v)) errors.push(`${name}.${field} 类型应为 ${base}，实际 ${typeof v}`)
    else if (base === 'number' && FIELD_RANGES[field]) {
      const [lo, hi] = FIELD_RANGES[field]
      if (v < lo || v > hi) errors.push(`${name}.${field} 越界: ${v} 不在 [${lo}, ${hi}]`)
    }
  }
  return { ok: errors.length === 0, errors }
}

export function makeTx({ txId, t0, t1, seed, events = [] }) {
  return { txId, t0, t1, dtMs: Math.max(0, t1 - t0), seed, events, claimed: new Set() }
}

export function makeRng(seed, organId = '', tick = 0) {
  let s = (seed ^ hash(organId) ^ (tick * 2654435761)) >>> 0
  return () => {
    s = (s + 0x6d2b79f5) >>> 0
    let t = s
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function hash(str) {
  let h = 2166136261
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

export function findNonFinite(value, path = '$', out = []) {
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) out.push(path)
  } else if (Array.isArray(value)) {
    value.forEach((v, i) => findNonFinite(v, `${path}[${i}]`, out))
  } else if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) findNonFinite(v, `${path}.${k}`, out)
  }
  return out
}

/** 器官在心跳里的先后（从契约读，不许写死） */
export function organOrder() {
  return Object.keys(ORGANS).sort((a, b) => ORGANS[a].phase - ORGANS[b].phase)
}
