// 融合：这是 core 唯一"有创造性"的地方，也是唯一允许它做近似判断的地方。
// 它不实现任何器官的算法：只读各器官 read() 的绝对值，按固定权重合成"此刻"。
// 谁要是往这里塞 threat 的衰减、felt 的积分，那就是第六个声音。

const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, Number.isFinite(n) ? n : lo))

export const EMOTION_PROTOTYPES = [
  { kind: '开心', sig: [0.7, 0.8, 1, 0.6, 0.6, 0, 0.4] },
  { kind: '兴奋', sig: [0.8, 0.8, 1, 0.5, 0.5, 0, 0.6] },
  { kind: '满足', sig: [0.5, 0.6, 0, 0.8, 0.8, 0.2, 0.1] },
  { kind: '安心', sig: [0.6, 0.5, 1, 0.8, 0.9, 0.2, 0.2] },
  { kind: '感动', sig: [0.8, 0.7, 1, 0.7, 0.4, 0.5, 0.5] },
  { kind: '得意', sig: [0.6, 0.7, 0, 0.9, 0.9, 0, 0.3] },
  { kind: '害羞', sig: [0.7, 0.3, 1, 0.6, 0.3, 0.1, 0.4] },
  { kind: '心动', sig: [0.9, 0.8, 1, 0.4, 0.3, 0, 0.7] },
  { kind: '想念', sig: [0.7, 0.6, 1, 0.5, 0.2, 0, 0.3] },
  { kind: '生气', sig: [0.8, -0.7, 1, 0.9, 0.6, -0.5, 0.5] },
  { kind: '委屈', sig: [0.9, -0.7, 1, 0.7, 0.2, -0.4, 0.3] },
  { kind: '失望', sig: [0.8, -0.8, 1, 0.8, 0.3, -0.2, 0.4] },
  { kind: '难过', sig: [0.7, -0.8, 0.5, 0.7, 0.2, 0, 0.3] },
  { kind: '心痛', sig: [0.9, -0.8, 1, 0.6, 0.2, 0, 0.3] },
  { kind: '焦虑', sig: [0.6, -0.5, 0.5, 0.4, 0.2, 0, 0.4] },
  { kind: '紧张', sig: [0.5, -0.4, 0.5, 0.5, 0.3, 0, 0.5] },
  { kind: '害怕', sig: [0.8, -0.8, 0.5, 0.7, 0.1, 0, 0.7] },
  { kind: '内疚', sig: [0.8, -0.6, 0, 0.9, 0.5, -0.6, 0.3] },
  { kind: '羞耻', sig: [0.9, -0.7, 0, 0.8, 0.2, -0.7, 0.4] },
  { kind: '厌烦', sig: [0.5, -0.5, 1, 0.8, 0.5, -0.3, 0.3] },
]

/** agency 不是数，先压成一个数：自己 0 / 别人 1 / 环境 0.5。 */
function agencyValue(agency) {
  if (typeof agency === 'number') return clamp(agency, 0, 1)
  if (agency === 'self') return 0
  if (agency === 'other') return 1
  return 0.5
}

export function toVector(appraisal) {
  return [
    clamp(appraisal.relevance, 0, 1),
    clamp(appraisal.goalCongruence, -1, 1),
    agencyValue(appraisal.agency),
    clamp(appraisal.certainty, 0, 1),
    clamp(appraisal.coping, 0, 1),
    clamp(appraisal.norm, -1, 1),
    clamp(appraisal.novelty, 0, 1),
  ]
}

function cosine(a, b) {
  let dot = 0, na = 0, nb = 0
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i]
    na += a[i] * a[i]
    nb += b[i] * b[i]
  }
  if (!na || !nb) return 0
  return dot / (Math.sqrt(na) * Math.sqrt(nb))
}

function norm(v) {
  let n = 0
  for (const x of v) n += x * x
  return Math.sqrt(n)
}

/**
 * 从评价向量构造情绪。不是 if-else 查表，是最近原型 + 混合。
 * 同一个 appraisal 在不同 mood/arousal 下会落到不同原型上，这是设计目标。
 */
export function constructEmotion(appraisal, arousal = 0.5) {
  const vec = toVector(appraisal)
  const magnitude = norm(vec) || 1
  const arousalFactor = 0.7 + 0.5 * clamp(arousal, 0, 1)
  const scored = EMOTION_PROTOTYPES.map(p => {
    const sim = cosine(vec, p.sig)
    return { kind: p.kind, sim, intensity: clamp(sim * sim * magnitude * arousalFactor, 0, 1) }
  }).sort((a, b) => b.intensity - a.intensity)

  const picked = scored.filter(s => s.sim > 0.55 && s.intensity >= 0.05).slice(0, 3)
  if (!picked.length) return { primary: null, mixed: [], all: scored.slice(0, 3) }

  const [primary, ...rest] = picked
  // 只有方向不同的才叫"又气又心疼"；同向的（开心+兴奋）不算混合
  const mixed = rest.filter(r => Math.sign(r.intensity) !== 0 && r.kind !== primary.kind)
  return {
    primary: { kind: primary.kind, intensity: primary.intensity },
    mixed: mixed.map(m => ({ kind: m.kind, intensity: m.intensity })),
    all: scored.slice(0, 5),
  }
}

/**
 * 主融合。
 * reads: { 'affect.amygdala': {...read()}, ... } —— 只放还活着的器官
 * persona: 人格参数
 * state: 上一轮融合结果（mood 是慢变量，要带过来）
 */
export function fuse({ reads, persona, state, dtMs, ctx = {} }) {
  const clampRange = (v, lo, hi) => clamp(v, lo, hi)
  const dtH = Math.min(dtMs, 24 * 3600_000) / 3600_000

  const amy = reads['affect.amygdala'] || {}
  const hypo = reads['affect.hypothalamus'] || {}
  const ins = reads['affect.insula'] || {}
  const hip = reads['affect.hippocampus'] || {}
  const pfc = reads['affect.pfc'] || {}

  const threat = clampRange(amy.threat ?? 0, 0, 1)
  const rewardPE = clampRange(amy.rewardPE ?? 0, -1, 1)
  const novelty = clampRange(amy.novelty ?? 0, 0, 1)
  const salience = clampRange(amy.salience ?? 0, 0, 1)

  const cortisol = clampRange(hypo.cortisol ?? 0, 0, 1)
  const energy = clampRange(hypo.energy ?? 0.6, 0, 1)
  const sleepDebt = clampRange(hypo.sleepDebt ?? 0, 0, 1)
  const moodBias = clampRange(hypo.moodBias ?? 0, -1, 1)

  const feltIntensity = clampRange(ins.feltIntensity ?? ins.intensity ?? 0, 0, 1)
  const qualities = Array.isArray(ins.qualities) ? ins.qualities.slice(0, 3) : []
  const location = typeof ins.location === 'string' ? ins.location : ''
  const bodyBudget = clampRange(ins.bodyBudget ?? 0.6, 0, 1)

  const priorBias = clampRange(hip.recallBias ?? 0, -1, 1)
  const priorConfidence = clampRange(hip.confidence ?? 0, 0, 1)

  const bandwidth = clampRange(pfc.bandwidth ?? 0.6, 0, 1)
  const mask = clampRange(pfc.mask ?? 0, 0, 1)
  const toneShift = ['soft', 'normal', 'hard', 'flat'].includes(pfc.toneShift) ? pfc.toneShift : 'normal'
  const brevity = clampRange(pfc.brevity ?? 0.4, 0, 1)
  const leakRisk = clampRange(pfc.leakRisk ?? 0, 0, 1)

  // 1) 这一次事件的效价：威胁负、奖赏正、旧事先例带一点偏
  const eventValence = clampRange(0.6 * -threat + 0.4 * rewardPE + 0.15 * priorBias, -1, 1)

  // 2) 唤醒：快变量
  const arousal = clampRange(
    persona.arousalGain * (0.5 * threat + 0.3 * cortisol + 0.2 * feltIntensity),
    0, 1,
  )

  // 3) 身体偏置：体力低、睡不够 → 整体往下沉
  const bodyBias = clampRange(0.5 * (energy - 0.5) + 0.3 * (bodyBudget - 0.5) + 0.2 * -sleepDebt, -1, 1)

  // 4) 心情：慢变量，向 target 靠，tau 小时单位
  const prevMood = typeof state?.mood === 'number' ? state.mood : persona.moodBase
  const target = clampRange(
    0.55 * eventValence + 0.25 * persona.moodBase + 0.10 * bodyBias + 0.10 * moodBias,
    -1, 1,
  )
  const k = 1 - Math.exp(-dtH / Math.max(0.1, persona.tauMoodH))
  let mood = prevMood + (target - prevMood) * k
  // 心情偏离基线的上限：不然一次吵架能让她永久阴沉
  mood = clampRange(mood, persona.moodBase - persona.moodCap, persona.moodBase + persona.moodCap)

  // 5) 总效价：事件为主，心情和身体各占一点
  const valence = clampRange(
    0.7 * eventValence + 0.2 * mood + 0.1 * bodyBias,
    -1, 1,
  )

  // 6) 评价向量。器官能给的直接拿，给不了的用近似——但都在这里注明来源。
  const appraisal = {
    relevance: clampRange(0.9 * Math.max(salience, feltIntensity, Math.abs(eventValence)), 0, 1),
    goalCongruence: valence,
    agency: threat > 0.3 ? 'other' : (Math.abs(rewardPE) > 0.3 ? 'circumstance' : 'self'),
    certainty: clampRange(0.55 + 0.2 * threat, 0, 1),
    coping: clampRange(bandwidth, 0, 1),
    norm: 0,
    novelty: clampRange(novelty, 0, 1),
  }

  const emotion = constructEmotion(appraisal, arousal)

  // 7) 表现倾向：只转述 PFC，不改写。缺 PFC 时按"想什么就说什么"降级。
  const hasPfc = !!reads['affect.pfc']
  const display = hasPfc
    ? { mask, toneShift, brevity: clampRange(brevity * persona.expressGain, 0, 1), leakRisk }
    : { mask: 0, toneShift: 'normal', brevity: clampRange(0.3 * persona.expressGain, 0, 1), leakRisk: 0 }

  const primary = emotion.primary
  const emotions = primary
    ? [{ kind: primary.kind, intensity: primary.intensity, mixed: emotion.mixed }]
    : []

  return {
    valence,
    arousal,
    mood,
    emotions,
    appraisal,
    body: {
      intensity: feltIntensity,
      qualities,
      location,
      energy,
      sleepDebt,
      bodyBudget,
      cortisol,
    },
    display,
    attention: {
      focusedOn: salience > 0.5 ? ['眼前的人'] : [],
      precision: clampRange(0.4 + 0.5 * salience, 0, 1),
    },
    prior: { bias: priorBias, confidence: priorConfidence, hits: Array.isArray(hip.hits) ? hip.hits.length : 0 },
    degraded: Object.keys(reads).length < 5 ? Object.keys(reads) : [],
    emotionScores: emotion.all,
  }
}

/** 空状态：五个器官全缺时的"降级态"，不是坏掉。 */
export function baseState(persona) {
  return {
    valence: 0,
    arousal: 0,
    mood: persona.moodBase,
    emotions: [],
    appraisal: {
      relevance: 0, goalCongruence: 0, agency: 'circumstance',
      certainty: 0.5, coping: 0.5, norm: 0, novelty: 0,
    },
    body: { intensity: 0, qualities: [], location: '', energy: 0.6, sleepDebt: 0, bodyBudget: 0.6, cortisol: 0 },
    display: { mask: 0, toneShift: 'normal', brevity: 0.3, leakRisk: 0 },
    attention: { focusedOn: [], precision: 0.5 },
    prior: { bias: 0, confidence: 0, hits: 0 },
    degraded: [],
    emotionScores: [],
    tick: 0,
    at: 0,
    version: 1,
  }
}
