// 融合层：把 15 个模块的 read() 合成"此刻的她"。
// 情绪是"评价向量 × 原型"构造出来的，不是 if-else。

import { clamp, PROTOTYPES, NEG_KINDS } from './consts.js'
import { analyzeMessage } from './context.js'

const toUnit = (x) => (clamp(x, -1, 1) + 1) / 2
const vec = (a) => [clamp(a.relevance, 0, 1), toUnit(a.goal), clamp(a.agencyOther, 0, 1), clamp(a.certainty, 0, 1), clamp(a.coping, 0, 1), toUnit(a.norm), clamp(a.novelty, 0, 1)]
const norm = (v) => { const n = Math.hypot(...v) || 1; return v.map(x => x / n) }
const dot = (a, b) => a.reduce((s, x, i) => s + x * b[i], 0)

const RAW = PROTOTYPES.map(p => [p.v[0], toUnit(p.v[1]), p.v[2], p.v[3], p.v[4], toUnit(p.v[5]), p.v[6]])
const MEAN = Array.from({ length: 7 }, (_, i) => RAW.reduce((s, v) => s + v[i], 0) / RAW.length)
const CENT = RAW.map(v => norm(v.map((x, i) => x - MEAN[i])))

export function appraisalOf(amy, { trust = 0.6, bandwidth = 0.6, neg = 0, hostile = 0, context = null, threatGain = 1 } = {}) {
  // threatGain：同一次威胁，对一个"更容易被扎到"的人意味着更多。
  // 默认 1，人格不写就跟原来的数一模一样。
  const threatRaw = clamp((amy?.threat ?? 0) * (1 + 0.3 * neg) * threatGain, 0, 1)
  // 静息威胁不是"这句话不好"：人身上本来就带一点警觉（0.12）。
  // 以前把整条 threat 都乘进 goal（-0.8×threat），于是一旦警觉被顶到 1，
  // 夸她一句也是"不顺意"——线上"吃到好吃的"被判成心痛就是这么来的。
  // 现在只算高出静息的那一截（量纲同 threat，0..1），那才是"这一拍发生了坏事"的证据。
  const threat = Math.max(0, threatRaw - 0.12)
  // 静息威胁是噪声，不是"这句话不顺"。
  // 以前 goal = rewardPE - 0.8 * threat，而杏仁核静息威胁约 0.05，
  // 于是任何中性话都拿到 goal ≈ -0.04：心情被一路拖着往下，
  // 十轮纯技术对话就能从 0.10 掉到 0.00，还会凭空冒出"厌烦/心痛"。
  // 减掉地板之后再算：中性话真的回到 0，真威胁该多冲还是多冲。
  const pos = clamp(amy?.rewardPE ?? 0, 0, 1)
  const kind = amy?.kind ?? 'neutral'
  let goal = clamp((amy?.rewardPE ?? 0) - 0.8 * threat, -1, 1)
  let coping = clamp(0.30 + 0.6 * bandwidth - 0.45 * threat + 0.15 * pos, 0, 1)
  let normv = threat > 0.5 ? -0.4 : 0
  let agencyOther = threat > 0.2 || pos > 0.2 ? 0.85 : 0.45
  if (kind === 'apology') { goal = clamp(goal + 0.45, -1, 1); coping = clamp(coping + 0.25, 0, 1); normv = 0.2; agencyOther = 0.9 }
  if (kind === 'positive') { goal = clamp(goal + 0.15, -1, 1); normv = 0.15; agencyOther = 0.9 }

  let relevance = clamp(0.30 + 0.55 * trust + 0.25 * threat + 0.10 * pos, 0, 1)
  let certainty = clamp(0.55 + 0.25 * (1 - (amy?.novelty ?? 0)), 0, 1)

  // 上下文修正：同一句话，在"刚被抱怨过"和"只是问个问题"里意义不一样
  if (context) {
    if (context.complaint) { goal = clamp(goal - 0.18, -1, 1); coping = clamp(coping - 0.08, 0, 1) }
    if (context.praise) { goal = clamp(goal + 0.10, -1, 1); relevance = clamp(relevance + 0.05, 0, 1) }
    if (context.question) { certainty = clamp(certainty + 0.10, 0, 1); relevance = clamp(relevance + 0.05, 0, 1) }
    if (context.rush) { coping = clamp(coping - 0.12, 0, 1); certainty = clamp(certainty - 0.05, 0, 1) }
    if (context.addressed) relevance = clamp(relevance + 0.08, 0, 1)
    if (context.moodTrend < -0.3) { goal = clamp(goal - 0.08, -1, 1); agencyOther = clamp(agencyOther + 0.1, 0, 1) }
  }

  return {
    relevance,
    goal, agencyOther,
    certainty,
    coping, norm: normv,
    novelty: clamp(amy?.novelty ?? 0, 0, 1),
  }
}

// 明确的正性事件：被夸 / 吃到好吃的 / 听到喜欢的歌 / 事情顺。
// 单独导出，是因为引擎要在"器官跑完、融合之前"用它做一次安全消退（A07），
// 两边必须用同一把尺子，否则会出现"引擎觉得没事、融合觉得被骂"的分裂。
const GOOD_CUE = /厉害|太棒|真好|谢谢|辛苦|开心|喜欢|不错|好吃|好喝|好听|顺利|搞定|成了|通过了|靠谱|舒服|抱|想你|夸|平安|稳|香/
const STING_CUE = /不行|做不好|算了|不指望|就这|烦死|无语|服了|闭嘴|又忘|第三次|受不了|随便吧|不想聊|失望|呵呵|你可真行|真是绝了/
export function positiveEvent(text) {
  const s = String(text || '')
  return Boolean(s) && GOOD_CUE.test(s) && !STING_CUE.test(s)
}

// 器官亲和表：哪种情绪主要由哪个器官推。权重是"谁更像在负责"，不是物理量。
const ORGAN_AFFINITY = {
  焦虑: { intero: 1.0, exec: 0.3 },
  害怕: { intero: 0.9, exec: 0.2 },
  紧张: { intero: 0.8, exec: 0.2 },
  厌烦: { intero: 0.5, exec: 0.5 },
  生气: { exec: 0.5, social: 0.3 },
  心痛: { social: 0.9, intero: 0.4 },
  委屈: { social: 1.0, intero: 0.2 },
  失望: { social: 0.7, exec: 0.3 },
  内疚: { social: 0.7, exec: 0.6 },
  羞耻: { social: 0.9, intero: 0.4 },
  安心: { social: 0.8, intero: 0.2 },
  平静: { intero: 0.4, social: 0.3 },
  开心: { social: 0.5, intero: 0.3 },
  心动: { social: 0.7, intero: 0.5 },
  害羞: { social: 0.8, intero: 0.4 },
}

export function constructEmotions(appraisal, arousal = 0.4, opts = {}) {
  const floor = Number(opts.floor ?? 0.05)
  const v = vec(appraisal)
  const centered = norm(v.map((x, i) => x - MEAN[i]))
  const mag = Math.min(1, Math.hypot(...v) / 2.2)
  // 器官专用维度：不进余弦，只做"这类情绪更由哪个器官推动"的加分。
  // 这样保持原有几何（阈值不用重标），又能让岛叶/社会/PFC 各自有话语权。
  const od = opts.organDims || null
  const organBonus = (kind) => {
    if (!od) return 0
    const a = ORGAN_AFFINITY[kind]
    if (!a) return 0
    return 0.28 * ((a.intero ?? 0) * (od.intero ?? 0)
      + (a.social ?? 0) * (od.social ?? 0)
      + (a.exec ?? 0) * (od.exec ?? 0))
  }
  // 先按符号与规范限制候选，再在候选里挑最像的——顺序反过来就永远挑错
  const allowed = PROTOTYPES.map((p, i) => ({ p, i })).filter(({ p }) => {
    if (appraisal.goal < -0.05 && !NEG_KINDS.has(p.kind)) return false
    if (appraisal.goal > 0.05 && NEG_KINDS.has(p.kind)) return false
    if ((appraisal.norm ?? 0) >= -0.1 && (p.kind === '内疚' || p.kind === '羞耻')) return false
    return true
  })
  const scored = (allowed.length ? allowed : PROTOTYPES.map((p, i) => ({ p, i })))
    .map(({ p, i }) => ({ kind: p.kind, sim: dot(centered, CENT[i]) + organBonus(p.kind) }))
    .sort((a, b) => b.sim - a.sim)
  const top = scored.filter(x => x.sim > 0.35).slice(0, 3)
  // 共存也要有主次：先把主情绪封顶，再按名次打折。不能三个都顶到 1。
  const baseOf = (x) => (0.5 + 0.5 * x.sim) * (0.55 + 0.45 * mag) * (0.6 + 0.4 * arousal)
  const list = (top.length ? top : [scored[0]]).map((x, i) => ({
    kind: x.kind,
    intensity: clamp(Math.min(baseOf(x), 1) * (1 - 0.15 * i), 0, 1),
  }))
  if (!list.length) return []
  const main = list[0]
  // 共存：不只取最强的那个。人身上常见"又气又委屈"——两三个同时在场，主次有别。
  const out = [main, ...list.slice(1).filter(e => e.intensity >= 0.45 * main.intensity)].filter(e => e.intensity >= floor).slice(0, 3)
  // 语境明确时不许空手：哪怕很弱，也给最像的那个
  if (!out.length && opts.force && scored.length) return [{ kind: scored[0].kind, intensity: 0.12 }]
  return out
}

export function fuse(world, mood, persona) {
  const g = (id) => world.get(id)
  const amy = g('amygdala'), hyp = g('hypothalamus'), ins = g('insula'), hip = g('hippocampus')
  const pf = g('pfc'), soc = g('social'), att = g('attention'), nm = g('neuromod')
  const dmn = g('dmn'), endo = g('endocrine'), sick = g('sickness'), cur = g('curve')
  const rhy = g('rhythm'), bi = g('bias'), io = g('io')

  const threat = amy?.threat ?? 0
  // 器官之间是"调增益"，不是"加数值"：
  //   缺觉 → 杏仁核更容易被点着（人第二天火气大，就是这个）
  //   岛叶精度 → 身体感更清楚，威胁看得更重
  //   PFC 余量 → 能把威胁往下压
  const gainSleep = 1 + 0.35 * clamp(Number(hyp?.sleepDebt ?? 0), 0, 1)
  const gainIntero = 1 + 0.25 * Math.max(0, clamp(Number(ins?.precision ?? 0.5), 0, 1) - 0.5) * 2
  const gainPfc = 1 - 0.20 * clamp(Number(pf?.pfcGain ?? 0.5), 0, 1)
  const amyGain = clamp(gainSleep * gainIntero * gainPfc * (1 + 0.3 * clamp((Number(amy?.sensMax ?? 1)) - 1, 0, 1)) * (1 + 0.2 * clamp(Number(amy?.ne ?? 0), 0, 1)), 0.6, 2.4)
  // 人格三旋钮（默认中性：1 / 0 / 1）——人格不写，数值和以前一模一样。
  //   threatGain   同一次威胁，对更在意的人更扎
  //   baselineMood 底色偏移（向上/向下的长期基调）
  //   sensitivity  感受强度（身体的动静被放大的倍数）
  const pg = clamp(Number(persona?.threatGain ?? 1), 0.5, 2)
  const pSens = clamp(Number(persona?.sensitivity ?? 1), 0.5, 2)
  const pBase = clamp(Number(persona?.baselineMood ?? 0), -0.2, 0.2)
  const felt = ins?.felt ?? { intensity: 0, qualities: [], location: '' }
  const arousal = clamp(0.40 * threat + 0.25 * (hyp?.hpa?.cortisol ?? 0) + 0.25 * felt.intensity + 0.10 * (nm?.ne ?? 0.3), 0, 1)

  const appraisal = appraisalOf({ ...(amy || {}), threat: clamp(threat * amyGain, 0, 1) }, {
    trust: soc?.trust ?? 0.6,
    bandwidth: pf?.bandwidth ?? 0.6,
    neg: bi?.neg ?? 0,
    hostile: bi?.hostile ?? 0,
    context: world.context ?? null,
    threatGain: pg,
  })
  // 重评成功：把"顺不顺意"往回调一点
  if (pf?.reappraisal?.success) appraisal.goal = clamp(appraisal.goal + 0.12, -1, 1)
  // P13 道德判断：越界会让"该不该"更负
  if ((pf?.moral ?? 0) > 0.4) appraisal.norm = clamp(appraisal.norm - 0.2, -1, 1)

  // ── 仪表页要的"每个器官这一帧的真实贡献" ──
  // 单位：评价向量各维被它挪动的绝对量之和（goal/coping/certainty/relevance/agencyOther/norm，
  // 都是 -1..1 或 0..1 的无量纲评价量）。为什么量"改动"而不是"读数"：
  // 一个器官可能读数很高但这一帧什么也没说（比如缺觉但没发生事），那它在"此刻的她"里就不该有声音；
  // 反过来，社会层读数平平，但它把 coping 抬了 0.12，就该有声音。
  const organDelta = { insula: 0, pfc: 0, social: 0, attention: 0, brainstem: 0, neuromod: 0, endocrine: 0, amygdala: 0, rhythm: 0, dmn: 0, curve: 0, hippocampus: 0 }
  const appSnap = () => ({
    goal: Number(appraisal.goal) || 0, coping: Number(appraisal.coping) || 0,
    certainty: Number(appraisal.certainty) || 0, relevance: Number(appraisal.relevance) || 0,
    agencyOther: Number(appraisal.agencyOther) || 0, norm: Number(appraisal.norm) || 0,
  })
  const markDelta = (id, b) => {
    organDelta[id] = Math.abs((Number(appraisal.goal) || 0) - b.goal)
      + Math.abs((Number(appraisal.coping) || 0) - b.coping)
      + Math.abs((Number(appraisal.certainty) || 0) - b.certainty)
      + Math.abs((Number(appraisal.relevance) || 0) - b.relevance)
      + Math.abs((Number(appraisal.agencyOther) || 0) - b.agencyOther)
      + Math.abs((Number(appraisal.norm) || 0) - b.norm)
  }

  // ── 把器官内部的读数接到评价上 ──
  // 以前这些值只在各自模块里累积，输出根本看不见；现在至少让它们改得动评价。
  // A05–A13：敏化/线索捕获 → 威胁乘子（学到的东西要能表现出来）
  const learnGain = 1 + 0.25 * clamp((amy?.sensMax ?? 1) - 1, 0, 1) + 0.20 * clamp(amy?.capture ?? 0, 0, 1)
  if (learnGain > 1.01) {
    appraisal.goal = clamp(appraisal.goal - 0.12 * (learnGain - 1), -1, 1)
    appraisal.coping = clamp(appraisal.coping - 0.10 * (learnGain - 1), 0, 1)
  }
  // H04/H20：睡眠债压应对、压确定性（缺觉的人更没耐心）
  const sleepDebt = clamp(Number(hyp?.sleepDebt ?? 0), 0, 1)
  if (sleepDebt > 0.25) {
    appraisal.coping = clamp(appraisal.coping - 0.18 * sleepDebt, 0, 1)
    appraisal.certainty = clamp(appraisal.certainty - 0.10 * sleepDebt, 0, 1)
  }
  // S07：人情没清 → 防备、少一点确定
  const ledgerOpen = clamp(Number(soc?.ledgerOpen ?? (soc?.ledger && soc.ledger.open) ?? 0), 0, 1)
  if (ledgerOpen > 0.2) {
    appraisal.certainty = clamp(appraisal.certainty - 0.15 * ledgerOpen, 0, 1)
    appraisal.agencyOther = clamp(appraisal.agencyOther + 0.10 * ledgerOpen, 0, 1)
  }
  // D03：反刍会把"顺不顺意"往下拖
  const rumination = clamp(Number(dmn?.rumination ?? 0), 0, 1)
  if (rumination > 0.3) {
    const _b = appSnap()
    appraisal.goal = clamp(appraisal.goal - 0.10 * rumination, -1, 1)
    markDelta('dmn', _b)
  }
  // P23：赶时间时会硬压住情绪（应对看起来更高，但其实更短）
  const timePressure = clamp(Number(pf?.timePressure ?? pf?.display?.timePressure ?? 0), 0, 1)
  if (timePressure > 0.3) appraisal.coping = clamp(appraisal.coping + 0.10 * timePressure, 0, 1)
  // N04：注意窄化——情绪高的时候，好的那面进不来
  const narrowing = clamp(Number(att?.narrowing ?? 0), 0, 1)

  // ── 器官各自的读法（不许糊成一个"总情绪"）──
  // 每个器官用它自己的量、按它自己的机制改评价，写在各自的块里，便于单独关掉/单测。

  // 岛叶：内感受。厌恶抬规范压力、渴求抬相关性、等待降应对、风险降确定、内感受精度放大强度
  if (ins) {
    const _b = appSnap()
    const g0 = clamp(Number(ins.disgust ?? 0), 0, 1)
    const crave = clamp(Number(ins.craving ?? 0), 0, 1)
    const wait = clamp(Number(ins.wait ?? 0), 0, 1)
    const risk = clamp(Number(ins.risk ?? 0), 0, 1)
    const aware = clamp(Number(ins.awareness ?? 0), 0, 1)
    const mis = clamp(Number(ins.mislabel ?? 0), 0, 1)
    if (g0 > 0.25) { appraisal.norm = clamp(appraisal.norm - 0.25 * g0, -1, 1); appraisal.goal = clamp(appraisal.goal - 0.10 * g0, -1, 1) }
    if (crave > 0.3) appraisal.relevance = clamp(appraisal.relevance + 0.15 * crave, 0, 1)
    if (wait > 0.3) appraisal.coping = clamp(appraisal.coping - 0.12 * wait, 0, 1)
    if (risk > 0.3) appraisal.certainty = clamp(appraisal.certainty - 0.20 * risk, 0, 1)
    if (aware > 0.5) appraisal.relevance = clamp(appraisal.relevance + 0.10 * aware, 0, 1)
    if (mis > 0.4) appraisal.certainty = clamp(appraisal.certainty - 0.12 * mis, 0, 1)
    markDelta('insula', _b)
  }

  // 前额叶：执行控制。负荷/疲劳吃带宽，冲突/后悔降确定，自指抬相关性，命名降强度
  if (pf) {
    const _b = appSnap()
    const load = clamp(Number(pf.load ?? 0) + Number(pf.fatigue ?? 0), 0, 2) / 2
    const conf = clamp(Number(pf.conflict ?? 0), 0, 1)
    const regret = clamp(Number(pf.regret ?? 0), 0, 1)
    const selfRef = clamp(Number(pf.selfRef ?? 0), 0, 1)
    const label = clamp(Number(pf.labeling ?? 0), 0, 1)
    const cap = clamp(Number(pf.cap ?? 1), 0, 1)
    if (load > 0.3) appraisal.coping = clamp(appraisal.coping - 0.15 * load, 0, 1)
    if (conf > 0.3) appraisal.certainty = clamp(appraisal.certainty - 0.15 * conf, 0, 1)
    if (regret > 0.3) appraisal.goal = clamp(appraisal.goal - 0.10 * regret, -1, 1)
    if (selfRef > 0.4) appraisal.relevance = clamp(appraisal.relevance + 0.12 * selfRef, 0, 1)
    if (cap < 0.4) appraisal.coping = clamp(appraisal.coping - 0.10 * (1 - cap), 0, 1)
    world.__labelRelief = 0.10 * label   // P19：说出来了，强度降一点，留给情绪构造后处理
    markDelta('pfc', _b)
  }

  // 社会层：共情。他人难受会抬自身强度；传染会拽心情；相似度抬信任；被安抚抬应对
  if (soc) {
    const _b = appSnap()
    const emp = clamp(Number(soc.affectiveEmpathy ?? 0) + Number(soc.cognitiveEmpathy ?? 0), 0, 2) / 2
    const other = clamp(Number(soc.otherFelt ?? 0), 0, 1)
    const sim = clamp(Number(soc.similarity ?? 0), 0, 1)
    const comfort = clamp(Number(soc.comfort ?? 0), 0, 1)
    const contagion = clamp(Number(soc.contagionOut ?? 0), 0, 1)
    if (other > 0.3) appraisal.relevance = clamp(appraisal.relevance + 0.10 * other * (0.5 + emp), 0, 1)
    if (sim > 0.4) appraisal.certainty = clamp(appraisal.certainty + 0.08 * sim, 0, 1)
    if (comfort > 0.4) appraisal.coping = clamp(appraisal.coping + 0.12 * comfort, 0, 1)
    if (contagion > 0.4) appraisal.goal = clamp(appraisal.goal + 0.08 * contagion, -1, 1)
    world.__contagion = contagion
    markDelta('social', _b)
  }

  // 注意层：门控与凸显决定"这事进不进得来"
  if (att) {
    const _b = appSnap()
    const gate = clamp(Number(att.gate ?? 0.5), 0, 1)
    const focus = clamp(Number(att.focus ?? 0.5), 0, 1)
    const salNet = clamp(Number(att.salienceNet ?? 0), 0, 1)
    if (salNet > 0.4) appraisal.relevance = clamp(appraisal.relevance + 0.08 * salNet, 0, 1)
    // 门关上了就真的进不来：不是减一点，是整个打折
    if (gate < 0.3) appraisal.relevance = clamp(appraisal.relevance * (0.45 + gate), 0, 1)
    if (focus > 0.6) appraisal.certainty = clamp(appraisal.certainty + 0.06 * focus, 0, 1)
    markDelta('attention', _b)
  }

  // 脑干：唤醒。唤醒高时强度抬、确定性降
  if (g('brainstem')) {
    const _b = appSnap()
    const bs = g('brainstem')
    const ar = clamp(Number(bs.arousal ?? 0), 0, 1)
    const coup = clamp(Number(bs.coupling ?? 0), 0, 1)
    if (ar > 0.5) appraisal.relevance = clamp(appraisal.relevance + 0.10 * ar, 0, 1)
    if (coup > 0.5) appraisal.certainty = clamp(appraisal.certainty - 0.08 * coup, 0, 1)
    markDelta('brainstem', _b)
  }

  // 内分泌：催产素抬确定/信任，睾酮抬攻击，甲状腺抬能量
  if (endo) {
    const _b = appSnap()
    const oxy = clamp(Number(endo.oxytocin ?? 0), 0, 1)
    const tes = clamp(Number(endo.testosterone ?? 0), 0, 1)
    const thy = clamp(Number(endo.thyroid ?? 0), 0, 1)
    if (oxy > 0.4) appraisal.certainty = clamp(appraisal.certainty + 0.10 * oxy, 0, 1)
    if (tes > 0.5) { appraisal.agencyOther = clamp(appraisal.agencyOther - 0.10 * tes, 0, 1); appraisal.norm = clamp(appraisal.norm - 0.10 * tes, -1, 1) }
    if (thy < 0.3) appraisal.coping = clamp(appraisal.coping - 0.10 * (1 - thy), 0, 1)
    markDelta('endocrine', _b)
  }

  // 调质：DA 抬目标，加压素抬攻击，阿片/内源大麻素抬应对
  if (nm) {
    const _b = appSnap()
    const da = clamp(Number(nm.da ?? 0.5), 0, 1)
    const vaso = clamp(Number(nm.vasopressin ?? 0), 0, 1)
    const opi = clamp(Number(nm.opioid ?? 0), 0, 1)
    const endoCan = clamp(Number(nm.endocannabinoid ?? 0), 0, 1)
    if (da > 0.55) appraisal.goal = clamp(appraisal.goal + 0.08 * da, -1, 1)
    if (vaso > 0.45) { appraisal.agencyOther = clamp(appraisal.agencyOther - 0.08 * vaso, 0, 1); appraisal.norm = clamp(appraisal.norm - 0.08 * vaso, -1, 1) }
    if (opi > 0.3) appraisal.coping = clamp(appraisal.coping + 0.10 * opi, 0, 1)
    if (endoCan > 0.3) appraisal.coping = clamp(appraisal.coping + 0.08 * endoCan, 0, 1)
    markDelta('neuromod', _b)
  }

  // 节律：周节律/季节/漂移只改底色，不改评价
  if (rhy) {
    const wk = clamp(Number(rhy.weekly ?? 0), -1, 1)
    const se = clamp(Number(rhy.seasonal ?? 0), -1, 1)
    const dr = clamp(Number(rhy.drift ?? 0), -1, 1)
    world.__rhythmBias = 0.06 * wk + 0.04 * se + 0.05 * dr
  }

  // 曲线：不应期里哄不动
  if (cur && cur.refractory) {
    const _b = appSnap()
    appraisal.coping = clamp(appraisal.coping - 0.10, 0, 1)
    markDelta('curve', _b)
  }

  // 杏仁核：快速反应与冻结进威胁；新奇抬相关
  if (amy) {
    const _b = appSnap()
    const fast = clamp(Number(amy.fastThreat ?? 0), 0, 1)
    const nv = clamp(Number(amy.novelty ?? 0), 0, 1)
    const frz = clamp(Number(amy.freeze ?? 0), 0, 1)
    if (fast > 0.3) appraisal.goal = clamp(appraisal.goal - 0.12 * fast, -1, 1)
    if (nv > 0.4) appraisal.relevance = clamp(appraisal.relevance + 0.08 * nv, 0, 1)
    if (frz > 0.4) appraisal.coping = clamp(appraisal.coping - 0.15 * frz, 0, 1)
    markDelta('amygdala', _b)
  }

  // 海马体这一帧的"声音"只有一条通路：想起旧事，把底色往那个方向拽。
  // 强度 = 这次回声实际拽动心情的量（echoPull 由引擎按新旧折过，-1..1）。
  organDelta.hippocampus = Math.abs(clamp(Number(world.echoPull ?? 0), -1, 1)) * 2

  // 语境直接看用户这句话本身：world.context 是给措辞用的，这里不能用它当准绳
  // 只看"这一拍"用户说了什么：不能回退到 context.lastText，
  // 那是一句话的旧影子，安静下来以后还挂着，会让心情一直按在被骂的那句上。
  const _utext = world.lastUserText || ''
  const _flags = _utext ? analyzeMessage(_utext) : null
  // 冒犯余温（引擎算的，0..1）：威胁落得快，但"刚才被扎过"这件事在十几分钟里
  // 仍然让下一句算"一件事"。只当门用，不当情绪强度用。
  const _offenseHeat = clamp(Number(world.offenseHeat ?? 0), 0, 1)
  // 余温只开"别把刚发生的事当成没发生"这一个口子（下面那个 filter），
  // 不参与 _hasEvent / LABEL_AGE 记账——否则一条余温会把"连续几拍没新事件"清零，
  // 标签就永远散不掉（仪表页上再也看不到"中性的一拍"）。
  // 对方已经在软话/哄人了，就不再扛着那口气：被哄还被记成"心痛"不是人。
  const _softening = /对不起|抱歉|我知道你|你也|不容易|辛苦了|别生气|我理解|不怪你|慢慢来|谢谢你|抱一下/.test(_utext)
  // 明确的好话/坏话，给评价一个"地板/天花板"。
  // 不这么做的话：被怼过一次之后 appraisal.goal 一直是负的，
  // 后面每一句都被判成坏消息——包括"你太厉害了"，人不是这么记仇的。
  // 只在字面明确时校准，且幅度有限（不是退回关键词判决）。
  // 明确的正性事件（被夸 / 吃到好吃的 / 听到喜欢的歌 / 事情顺）：
  // 不只看"字面是不是夸奖"，还要看"今天有没有好事"。词表粗，但方向是硬的：
  // 命中且没有刺 → 顺心程度至少 0.28（和夸奖的 0.25 同量级），不让残留威胁把它压回负数。
  const goodTurn = positiveEvent(_utext) && !_flags?.complaint && !_flags?.sarcasm
  // 余温这一个口子（见下面的 filter）：刚被扎过、这一句又没在哄人/不是好话，
  // 就把最强的那条情绪当余温留着；一旦对方在软话，立刻松手（被哄还记着"心痛"不是人）。
  const _keepHeat = _offenseHeat > 0.45 && !_softening && !goodTurn && !_flags?.praise
  if (_flags && !_flags.complaint) {
    if (_flags.praise) appraisal.goal = clamp(Math.max(appraisal.goal, 0.25), -1, 1)
  }
  if (goodTurn) {
    appraisal.goal = clamp(Math.max(appraisal.goal, 0.28), -1, 1)
    appraisal.coping = clamp(Math.max(appraisal.coping, 0.55), 0, 1)
  }
  if (_flags && !_flags.praise) {
    // 被骂不是「有点不顺」：直接把「顺不顺」压到更低，不然它还不如无关的闲聊掉得多
    if (_flags.complaint) appraisal.goal = clamp(Math.min(appraisal.goal, -0.5), -1, 1)
  }
  // 情绪由身上的状态定，文本只是旁证：
  // 以前只要字面像抱怨/夸奖就强制出情绪，没接记忆时等于退回关键词规则版。
  // 现在先看评价强度和唤醒度，文本只在"身体已经有点动静"时帮忙推一把。
  const mental = Math.max(Math.abs(appraisal.goal), appraisal.relevance * 0.5, Number(arousal) * 0.6)
  const textHint = goodTurn || !!(_flags && (_flags.complaint || _flags.praise))
  // 没有新的「话」在评价：上一次的判断要随时间淡掉，否则安静待着也会被旧评价按着
  if (!textHint) appraisal.goal = clamp(appraisal.goal * (arousal > 0.6 ? 0.7 : 0.35), -1, 1)
  const forced = mental > 0.5 || (textHint && mental > 0.12)
  // 器官专用维度：岛叶（身体有多响）、社会（对方在我这儿占多重要）、执行（我还有多少余量）。
  // 这三样是"并行的特征"，不是折算进七维的加数。
  const organDims = {
    intero: clamp((ins?.felt?.intensity ?? 0) * (0.4 + clamp(Number(ins?.precision ?? 0.5), 0, 1)) * (0.7 + 0.3 * clamp(Number(ins?.bodyBudget ?? 0.7), 0, 1)) * (0.8 + 0.2 * clamp(Number(ins?.bodySelf ?? 0.5), 0, 1)), 0, 1),
    social: clamp((soc?.otherFelt ?? 0) * (0.5 + clamp(Number(soc?.affectiveEmpathy ?? 0), 0, 1)) + (soc?.socialPain ?? 0) * 0.5, 0, 1),
    exec: clamp(clamp(Number(pf?.cap ?? 0.6), 0, 1) * (1 - 0.6 * clamp(Number(pf?.load ?? 0), 0, 1)), 0, 1),
  }
  const rawEmotions = constructEmotions(appraisal, arousal, { force: forced, organDims })
  // 注意门必须在所有"地板/天花板"之后再算一次：否则话里的正负线索会把它顶回去
  const gateV = clamp(Number(att?.gate ?? 1), 0, 1)
  if (gateV < 0.3) appraisal.relevance = clamp(appraisal.relevance * (0.45 + gateV), 0, 1)
  let emotions = rawEmotions.slice()
  // N04 注意窄化：情绪高的时候只看得见坏的那面（但至少留一条，不能空）
  if (narrowing > 0.5 && emotions.some(e => NEG_KINDS.has(e.kind))) {
    emotions = emotions.filter(e => NEG_KINDS.has(e.kind))
  }
  const candidates = rawEmotions.map(e => e.kind)
  // 语境明确（在抱怨 / 在夸）时不许被平线闸门吃掉，弱也要给一个最像的
  // 符号与规范约束：顺心程度为负时不许出正面情绪；没违背规范就不许出内疚/羞耻
  const goalSign = appraisal.goal
  if (goalSign < -0.05) emotions = emotions.filter(e => NEG_KINDS.has(e.kind))
  else if (goalSign > 0.05) emotions = emotions.filter(e => !NEG_KINDS.has(e.kind))
  if ((appraisal.norm ?? 0) >= -0.1) emotions = emotions.filter(e => e.kind !== '内疚' && e.kind !== '羞耻')
  // 归因决定方向：不怪自己的时候，也不该冒出内疚/羞耻
  const locus = pf?.attribution?.locus ?? 'circumstance'
  if (locus !== 'self') emotions = emotions.filter(e => e.kind !== '内疚' && e.kind !== '羞耻')
  // 中性输入不该硬凑出一个情绪：目标几乎没动、威胁也低，就让她平静
  const flat = Math.abs(appraisal.goal) < 0.16 && (amy?.threat ?? 0) < 0.3 && Math.abs(amy?.rewardPE ?? 0) < 0.15
  if (flat && !forced && !goodTurn) {
    // 平线闸门以前会把余温也一起清掉，所以"骂完下一句就没了"。
    // 有最近事件、还在保质期内，就留一个慢慢变淡的余温。
    const _lk = globalThis.__AFFECT_LAST_KIND__
    const _age2 = globalThis.__AFFECT_LABEL_AGE__ ?? 0
    // 余温只在"没有新事件、且新评价没有跟它反着来"时保留；年龄上限 2 拍，强度更低。
    // 否则骂完一句夸一句，余温会把夸奖整个盖掉（实测表扬→心痛）。
    const _lkNeg = NEG_KINDS.has(String(_lk || ''))
    const _conflict = (_lkNeg && appraisal.goal > 0.15) || (!_lkNeg && appraisal.goal < -0.15)
    emotions = (_lk && !_conflict && _age2 < 2)
      ? [{ kind: _lk, intensity: clamp(0.34 - 0.06 * _age2, 0.2, 0.34), from: 'linger' }]
      : []
  }
  // 强制语境下如果全被阈值滤掉，至少留最像的一个（弱情绪也是情绪）
  // ── 情绪标签的门与惯性 ───────────────────────────────
  // 她的判断决定这一拍有没有情绪：这句话被评价过（抱怨/夸奖/被吓/达成/受挫）才出标签。
  // 但情绪有惯性：刚被怼完，接下来几句没被惹也还带着余温，随历史权重淡下去。
  // threat 的绝对门槛现在只能覆盖"当场"：威胁按分钟级回落之后，
  // 被骂完下一分钟 threat 已经掉到 0.5 以下，那一下的余温要靠 offenseHeat 认。
  const _hasEvent = Boolean(
    goodTurn || (textHint) || forced ||
    Math.abs(appraisal.goal) >= 0.3 ||
    threat >= 0.5 ||
    Math.abs(Number(amy?.rewardPE ?? 0)) >= 0.3
  )
  const _hist = (globalThis.__AFFECT_APPRAISAL_HIST__ ||= [])
  const _now = Date.now()
  _hist.push({ at: _now, goal: Number(appraisal.goal) || 0, event: _hasEvent })
  while (_hist.length > 16) _hist.shift()
  let _inertia = 0
  let _wsum = 0
  for (let i = _hist.length - 1; i >= 0; i -= 1) {
    const h = _hist[i]
    if (_now - h.at > 30 * 60 * 1000) break
    const w = Math.pow(0.8, _hist.length - 1 - i)
    _inertia += h.goal * w
    _wsum += w
  }
  _inertia = _wsum ? _inertia / _wsum : 0
  // 分工：kind 由她"对这句话的评价"给（当场就有），强度由杏仁核给（威胁/体感多重）。
  const _eventKind = _flags && _flags.complaint
    ? '委屈'
    : _flags && _flags.praise
      ? '安心'
      : goodTurn
        ? '开心'
        : null
  if (_eventKind) globalThis.__AFFECT_LAST_KIND__ = _eventKind
  if (_eventKind && !emotions.some((e) => e.kind === _eventKind)) {
    emotions.unshift({ kind: _eventKind, intensity: clamp(0.24 + 0.5 * Math.max(threat, felt.intensity, 0.3), 0, 1), from: 'appraisal' })
  }
  emotions = emotions.map((e) => ({
    ...e,
    intensity: clamp((e.intensity ?? 0.3) * (0.55 + 0.45 * threat + 0.3 * felt.intensity), 0, 1),
  }))
  // 这一层会重新放大强度，前一步排好的主次会被抹平（两个都封到 1）。
  // 所以在最后再排一次：先按强度降序，再按名次打折。
  emotions = emotions
    .slice()
    .sort((a, b) => b.intensity - a.intensity)
    .map((e, i) => ({ ...e, intensity: clamp(e.intensity * (1 - 0.15 * i), 0, 1) }))
  if (process.env.DSH_FUSE_DEBUG) {
    console.error('[fuse]', JSON.stringify({ utext: _utext.slice(0, 30), complaint: !!_flags?.complaint, praise: !!_flags?.praise, event: _hasEvent, threat: Number(threat.toFixed(2)), kinds: emotions.map((e) => e.kind) }))
  }

  if (!_hasEvent) {
    const _last = globalThis.__AFFECT_LAST_KIND__
    // 余温只挂**一拍**：刚被怼完/刚被夸完，下一句还带着；再下一句就该平了。
    // 以前挂三拍，等于中性的一轮也永远有标签——仪表页上再也看不到"没什么大事"那一格。
    if (!emotions.length && _last && (globalThis.__AFFECT_LABEL_AGE__ ?? 0) < 2) {
      emotions = [{ kind: _last, intensity: clamp(0.30 - 0.07 * (globalThis.__AFFECT_LABEL_AGE__ ?? 0), 0.08, 0.3), from: 'linger' }]
    }
  }
  if (!_hasEvent) {
    // 这一句没被惹到也没被夸到：不凭空生成新情绪，只留惯性余温（而且会越来越淡）
    // 余温由上面的 linger 块负责；这里不再二次覆盖（以前这里会把余温清成空）
  }

  // 字面明确的这句：她自己当场就给出反应，不等杏仁核慢慢涨。
  if (!emotions.length && _flags && (_flags.complaint || _flags.praise)) {
    emotions = [{ kind: _flags.complaint ? '委屈' : '安心', intensity: 0.34, from: 'text' }]
  }

  // 标签的保质期：连续两拍都没有新事件，旧情绪就该散了，不能一直挂着。
  const _age = (globalThis.__AFFECT_LABEL_AGE__ = (_hasEvent ? 0 : (globalThis.__AFFECT_LABEL_AGE__ ?? 0) + 1))
  if (!_hasEvent && _age >= 2) emotions = []

  if (forced && !emotions.length && rawEmotions.length) {
    emotions = [{ ...rawEmotions[0], intensity: Math.max(0.12, rawEmotions[0].intensity) }]
  }
  // 情绪强度不能超过身体的感受强度：身体没起来，嘴上就不该那么重
  // sensitivity 放大的是"身体的动静"这一项——敏感的人同样的体感，情绪更重
  emotions = emotions.map(e => ({ ...e, intensity: clamp(e.intensity * clamp(0.35 + 0.65 * felt.intensity * pSens, 0, 1.2), 0, 1) }))
  // 不应期：强威胁后，正性情绪先压住
  if (cur?.refractory) emotions = emotions.map(e => NEG_KINDS.has(e.kind) ? e : { ...e, intensity: e.intensity * 0.4 })
  // 矛盾情绪
  const ambivalence = emotions.length > 1 ? clamp(emotions[1].intensity / Math.max(0.01, emotions[0].intensity), 0, 1) : 0

  // 和 appraisal 同一个道理：静息威胁不该被算成"这句不顺"。
  // 不扣地板的话，任何一句话的效价都带着 -0.018 的底色，
  // 心情就会一路向那个负值回落（十轮从 0.10 到 0.075，什么都没发生）。
  // 被真正安抚时威胁感往下走（一边道歉一边继续指责的不算）。
  // 不这么做，"对不起"说出口、身体还绷着，心情永远回不来。
  const soothed = !!(_flags && !_flags.complaint && (_flags.praise || /对不起|抱歉|是我说重|我错|别生气|别往心里去/.test(_utext)))
  // 量纲同 threat（0..1）：只有高出静息（0.12）的威胁才算"这一拍发生了坏事"。
  const threatV = clamp(Math.max(0, threat - 0.12) * pg * (soothed ? 0.55 : 1), 0, 1)
  // 被安抚：当场把旧情绪换掉，别让"委屈"再多挂几拍
  if (soothed) {
    globalThis.__AFFECT_LAST_KIND__ = '安心'
    globalThis.__AFFECT_LABEL_AGE__ = 0
    emotions = emotions.filter((e) => !NEG_KINDS.has(e.kind))
    if (!emotions.length) emotions = [{ kind: '安心', intensity: 0.3, from: 'soothe' }]
  }
  // 这一拍"发生了什么事"的值（-1..1）：引擎拿它当当场冲量，慢积分不重复算。
  // 0.55 是"一句很重的好话/坏话"折算到心情的系数：rewardPE 最大 1 → 最多 +0.55。
  // 回底项（0.20×(底色-当前)）刻意不在这里：那是慢积分的事，
  // 放进冲量等于"因为心情低，所以每句话都自动加分"，会把真正的坏事抵消掉。
  // 这一拍到底有没有"话"在评价：安静的时候，残留的威胁不该继续全额按心情。
  // 以前 threatV 不看有没有输入，于是威胁降不下来时，心情被同一条 -0.7×threatV 按住不放
  // （实测：threat 1 → 每拍 valence 抬不起来，mood 贴地板）。
  // 但也不能一刀切成 0：身体还绷着的时候，"心里不顺"本来就有余味——
  // 所以没话的那一拍留 35%，有话的那一拍照旧全额。
  const _hasTurnText = String(world.lastUserText || '').length > 0
  // 引擎里补上威胁的分钟级回落之后，这里就不必再人为打折：
  // 威胁本身会退，安静那一拍自然不会被按着；打折反而让"同一条通路"分不出轻重。
  const _threatW = _hasTurnText ? 0.7 : 0.7
  const eventValence = clamp(
    0.55 * ((amy?.rewardPE ?? 0) - _threatW * threatV) +
    // 她自己对这句话的判断也要算进去：但只在"这句正在被评价"的时候算，
    // 不然一句坏话会像欠债一样把心情永远按在水下。
    (textHint ? 0.25 * appraisal.goal : 0) +
    // 阴阳怪气：字面在夸，实际在刺——要压心情，不能靠"夸"的词面往回拉
    (textHint && _flags?.sarcasm ? -0.20 : 0) +
    // 被安抚时要有实打实的拉力，否则"回底色"会把道歉的效果吃掉
    (soothed ? 0.22 : 0) +
    // 人格的在意程度：同样一句难听的，越在意的人越疼一点点
    // （只用 threatV 不够——它到顶就饱和了，1.8 和 1.0 分不出来）
    (textHint && _flags?.complaint ? -0.10 * (pg - 1) : 0),
    -1, 1,
  )
  const valence = clamp(
    eventValence +
    0.20 * ((persona.moodBase ?? 0.1) - mood) +
    0.15 * (hyp?.rhythm?.moodBias ?? 0) +
    0.10 * (soc?.trust ? (soc.trust - 0.5) : 0),
    -1, 1,
  )

  // 没有新事件：这一拍不该长出新的情绪，只保留余温
  if (!_hasEvent) {
    if (_keepHeat && emotions.length) {
      // 刚被扎过、这一句没被扎：余温只带最强的那个，别把三个标签一起挂过去
      // （人不会一边"心痛"一边"委屈"一边"失望"地回你一句"日志里没有报错"）。
      emotions = [{ ...emotions[0], from: 'linger' }]
    } else {
      emotions = emotions.filter((e) => e.from === 'linger')
    }
  }
  // P19：把情绪说出来会轻一点；S09：被别人情绪带着走会重一点
  const relief = clamp(Number(world.__labelRelief ?? 0), 0, 0.2)
  const contagionOn = clamp(Number(world.__contagion ?? 0), 0, 1)
  if (relief > 0 || contagionOn > 0.4) {
    // 按比例减，不按减法：说出来了轻一档，但"谁主谁次"不能被一刀切抹平。
    // 以前是 intensity - 0.10，凡是小于 0.10 的小情绪全被压成 0，
    // 面板上就出现"四条并列 0.00"——不是没情绪，是主次被减法吃掉了。
    const _keep = clamp(1 - relief * 2, 0, 1)
    emotions = emotions.map(e => ({ ...e, intensity: clamp((e.intensity ?? 0) * _keep + 0.06 * contagionOn, 0, 1) }))
  }

  const moodTarget = clamp(
    (persona.moodBase ?? 0.1) + pBase + 0.45 * valence + 0.15 * (rhy?.bias ?? 0) + 0.1 * (hyp?.rhythm?.moodBias ?? 0) - 0.1 * (sick?.inflammation ?? 0)
      // 周节律/季节/漂移只动底色；这一拍想起旧事也会拽一下
      + Number(world.__rhythmBias ?? 0) + 0.05 * (dmn?.nostalgia ?? 0)
      // 记忆回声：只拽一点（±0.10），而且已经按"新旧"折过（引擎算的 echoPull）。
      // 以前是 0.12 × 原始 tone，同一件负面旧事每句话都全额扣一次 —— 等于一直在喂负性证据。
      + 0.10 * clamp(Number(world.echoPull ?? 0), -1, 1)
      // 没人说话、也没新事：心情朝底色回，略微高一点（同 mood 量纲，-1..1）。
      + ((textHint || goodTurn) ? 0 : 0.05),
    -1, 1,
  )

  const display = {
    mask: pf?.display?.mask ?? 0.3,
    toneShift: pf?.display?.toneShift ?? 'normal',
    brevity: clamp((pf?.display?.brevity ?? 0.3) * 0.6 + (io?.brevity ?? 0.3) * 0.4, 0, 1),
    leakRisk: pf?.display?.leakRisk ?? 0.2,
    rules: soc?.relationship === 'stranger' ? 0.2 : soc?.relationship === 'close' ? 0.7 : 0.4,
  }

  // X07：情绪对象由评价的"谁造成的"裁决，不由各器官各标一个
  const target = (() => {
    const locus = pf?.attribution?.locus ?? 'circumstance'
    if (locus === 'self') return '自己'
    if (locus === 'other') return '他'
    return '这件事'
  })()
  // 兜底：语境明确（抱怨/夸）却空手时，保留最像的那个弱情绪——情绪不许凭空消失
  if (!emotions.length && forced && rawEmotions.length) {
    emotions = [{ ...rawEmotions[0], intensity: Math.max(0.15, rawEmotions[0].intensity) }]
  }
  // 最后一刀：这一拍没有「硬事件」（她刚说的话被评价成好/坏，或拿到明显正反馈），
  // 就只准余温留在情绪里。注意：不能拿累积的威胁值当事件——
  // 否则只是"时间过去了、人累了"，也会被当成被惹到，凭空冒出心痛/厌烦。
  // felt 是身体唤醒，不是"这一拍发生了事"：拿它当硬事件会让余温永远不散（labels 一直红）。
  const _hardEvent = textHint || Number(amy?.rewardPE ?? 0) >= 0.35
  if (!_hardEvent && !_keepHeat) emotions = emotions.filter((e) => e.from === 'linger')

  // 阴阳怪气：字面是夸，实际是刺——负性放大一点，别被哄高兴
  if (_flags?.sarcasm) {
    emotions = emotions.map((e) => (NEG_KINDS.has(e.kind) ? { ...e, intensity: clamp((e.intensity ?? 0) * 1.25, 0, 1) } : e))
  }
  // 中性话这一拍：上一句留下的情绪只是余温，不算"新冒出来的"
  if (Boolean(textHint) && !(_flags?.complaint || _flags?.praise || _flags?.sarcasm)) {
    // 余温只能是余温：重新打标的那一步会把强度留着，必须在这里压回 0.42 以下
    emotions = emotions.map((e) => ({ ...e, from: 'linger', intensity: Math.min(e.intensity ?? 0.3, 0.42) }))
  }
  // 中性/安慰的话不该顶着上一句的强度：人话平了，情绪就该退一档
  const _mildText = !_flags?.complaint && !_flags?.praise && !_flags?.sarcasm
  const _comfort = /别急|慢慢来|辛苦了|抱一下|我信你|谢谢你|不怪你|冷静|慢慢说|我在听/.test(_utext)
  if (_mildText || _comfort) {
    const damp = _comfort ? 0.35 : 0.6
    emotions = emotions.map((e) => ({ ...e, intensity: clamp((e.intensity ?? 0) * damp, 0, 1) }))
  }
  // 抱怨就是抱怨：不许混进安心/感动这种正面情绪（"靠谱点"被当成夸奖是之前的老毛病）
  const _negCue = /又忘|忘了|第三次|受不了|靠谱点|别闹|别贫|说正事|行不行|崩|烦|累|随便吧|不想聊|算了|行了|就这样|别让我|失望/.test(_utext)
  if (_flags?.complaint || _negCue) {
    emotions = emotions.filter((e) => NEG_KINDS.has(e.kind))
    if (!emotions.length) {
      // 别一律给"委屈"：不同的刺扎出不同的情绪
      const kind = /又忘|忘了|第三次|靠谱/.test(_utext) ? '失望'
        : /受不了|烦|累|随便吧/.test(_utext) ? '厌烦'
          : /行不行|崩|傻/.test(_utext) ? '委屈'
            : '委屈'
      const base = kind === '厌烦' ? 0.26 : kind === '失望' ? 0.24 : 0.22
      emotions = [{ kind, intensity: base, from: 'text' }]
    }
  }

  // 明明白白带刺、却什么都没剩下：至少留一条弱的，不能当作没发生
  if (!emotions.length && /又忘|忘了|第三次|受不了|随便吧|不想聊|算了|行吧|不用了|下次吧/.test(_utext)) {
    emotions = [{ kind: '委屈', intensity: 0.22, from: 'text' }]
  }

  // 越想越气：反刍高的时候，同一件不顺的事会被放大（人就是这么自己气自己）
  const _rum = clamp(Number(dmn?.rumination ?? 0), 0, 1)
  if (_rum > 0.3) {
    emotions = emotions.map((e) => (NEG_KINDS.has(e.kind) ? { ...e, intensity: clamp((e.intensity ?? 0) * (1 + 0.35 * _rum), 0, 1) } : e))
  }

  // 前一拍是真的难受过、这一拍被哄好了：人不会立刻全好，留一条"还没缓过来"的残留
  const _prevNeg = (world.prevEmotions || []).find(x => NEG_KINDS.has(x.kind) && (x.intensity ?? 0) > 0.2)
  // 明确的正性事件（被夸/好事/被安抚）那一拍，不要残留压过当拍：
  // 人都被哄了，主情绪还挂着上一句的"生气"，就是线上那种"夸了也回不来"。
  if (_prevNeg && !goodTurn && !soothed && emotions.length && emotions.every(e => !NEG_KINDS.has(e.kind))) {
    // 残留只留一点点（≤0.14）：它是"还没全好"，不是"这句夸奖不算数"。
    // 以前上限 0.25，比一句好评能拿到的强度还高，于是夸她一句，主情绪还是委屈。
    emotions.push({ kind: _prevNeg.kind, intensity: clamp(Math.min(0.14, (_prevNeg.intensity ?? 0.2) * 0.45), 0.05, 0.14), from: 'linger' })
  }

  // 情绪按强度排序：主导情绪必须是强度最高的那个（不许我插进去的那条永远排第一）
  emotions.sort((a, b) => (b.intensity ?? 0) - (a.intensity ?? 0))

  return {
    valence, eventValence, organDelta,
    arousal, mood, moodTarget, appraisal, emotions, ambivalence, target,
    felt: { ...felt, intensity: clamp(cur?.intensity ?? felt.intensity, 0, 1) },
    body: hyp?.body ?? {},
    display,
    attribution: pf?.attribution ?? { locus: 'circumstance', confidence: 0.5 },
    bandwidth: pf?.bandwidth ?? 0.6,
    needs: hyp?.needs ?? {},
    energy: hyp?.rhythm?.energy ?? 0.6,
    recall: hip?.recall ?? null,
    trust: soc?.trust ?? 0.6,
    socialPain: soc?.socialPain ?? 0,
    attachment: soc?.attachment ?? 'secure',
    trustLedger: soc?.ledgerOpen ?? 0,
    mindRead: soc?.mindRead ?? 0.5,
    empathy: soc?.affectiveEmpathy ?? 0.5,
    rumination: dmn?.rumination ?? 0,
    mindWander: dmn?.mindWander ?? 0,
    attention: { focus: att?.focus ?? 0.4, narrowing: att?.narrowing ?? 0, sticky: att?.sticky ?? 0 },
    curve: { phase: cur?.phase ?? 'peak', refractory: cur?.refractory ?? false },
    rhythm: { weekly: rhy?.weekly ?? 0, seasonal: rhy?.seasonal ?? 0, drift: rhy?.drift ?? 0 },
    io: io ?? {},
    sickness: sick ?? {},
    hormones: endo ?? {},
    startle: g('brainstem')?.startle ?? 0,
    withdraw: sick?.withdraw ?? 0,
    repair: pf?.repair ?? 0,
    regret: pf?.regret ?? 0,
    error: pf?.error ?? 0,
    seekComfort: io?.seekComfort ?? 0,
    selfReportGap: io?.selfReportGap ?? 0,
    sleepGate: hyp?.sleepGate ?? 1,
    nostalgia: hip?.nostalgia ?? 0,
    idle: dmn?.mindWander ?? 0,
    socialImagining: dmn?.socialImagining ?? 0,
    persons: hip?.persons ?? {},
    attitude: soc?.attitude ?? {},
    contagion: soc?.contagionOut ?? 0,
    schemas: hip?.schemas ?? [],
    attachment: soc?.attachment ?? 'secure',
    memoryEcho: world.memoryEcho ?? null,
    // 细微状态：这些数原来只在各自器官里打转。放宽注入行数后，它们有了出口。
    signals: {

      sleepDebt: Number(sleepDebt.toFixed(3)),
      rumination: Number(rumination.toFixed(3)),
      ledgerOpen: Number(ledgerOpen.toFixed(3)),
      timePressure: Number(timePressure.toFixed(3)),
      narrowing: Number(narrowing.toFixed(3)),
      sensMax: Number((amy?.sensMax ?? 1).toFixed(3)),
      capture: Number((amy?.capture ?? 0).toFixed(3)),
      cyclePhase: hyp?.cyclePhase ?? hyp?.cycle?.phase ?? null,
      cycleDay: Number(hyp?.cycle?.day ?? 0),
      sickness: Number((sick?.inflammation ?? 0).toFixed(3)),
      fatigue: Number((sick?.fatigue ?? 0).toFixed(3)),
      hyperalgesia: Number((sick?.hyperalgesia ?? 0).toFixed(3)),
      ambivalence: Number((cur?.ambivalence ?? 0).toFixed(3)),
      secondPeak: Number((cur?.secondPeak ?? 0).toFixed(3)),
      refractory: cur?.refractory ?? false,
      nostalgia: Number((hip?.nostalgia ?? 0).toFixed(3)),
      mindWander: Number((dmn?.mindWander ?? 0).toFixed(3)),
      mentalTime: Number((dmn?.mentalTime ?? 0).toFixed(3)),
      socialImagining: Number((dmn?.socialImagining ?? 0).toFixed(3)),
      selfThought: Number((dmn?.selfThought ?? 0).toFixed(3)),
      empathyFatigue: Number((soc?.empathyFatigue ?? 0).toFixed(3)),
      status: Number((soc?.status ?? 0.5).toFixed(3)),
      mindRead: Number((soc?.mindRead ?? 0).toFixed(3)),
      attentionNarrowing: narrowing,
      // 器官各自的原始读数（给"各说各的"那几行用）
      disgust: Number((ins?.disgust ?? 0).toFixed(3)),
      craving: Number((ins?.craving ?? 0).toFixed(3)),
      wait: Number((ins?.wait ?? 0).toFixed(3)),
      risk: Number((ins?.risk ?? 0).toFixed(3)),
      awareness: Number((ins?.awareness ?? 0).toFixed(3)),
      mislabel: Number((ins?.mislabel ?? 0).toFixed(3)),
      resonance: Number((ins?.resonance ?? 0).toFixed(3)),
      precision: Number((ins?.precision ?? 0).toFixed(3)),
      cap: Number((pf?.cap ?? 0).toFixed(3)),
      load: Number((pf?.load ?? 0).toFixed(3)),
      conflict: Number((pf?.conflict ?? 0).toFixed(3)),
      regret: Number((pf?.regret ?? 0).toFixed(3)),
      selfRef: Number((pf?.selfRef ?? 0).toFixed(3)),
      labeling: Number((pf?.labeling ?? 0).toFixed(3)),
      pfcGain: Number((pf?.pfcGain ?? 0).toFixed(3)),
      slots: Number((pf?.slots ?? 0).toFixed(3)),
      error: Number((pf?.error ?? 0).toFixed(3)),
      moral: Number((pf?.moral ?? 0).toFixed(3)),
      otherFelt: Number((soc?.otherFelt ?? 0).toFixed(3)),
      affectiveEmpathy: Number((soc?.affectiveEmpathy ?? 0).toFixed(3)),
      cognitiveEmpathy: Number((soc?.cognitiveEmpathy ?? 0).toFixed(3)),
      contagionOut: Number((soc?.contagionOut ?? 0).toFixed(3)),
      selfOther: Number((soc?.selfOther ?? 0).toFixed(3)),
      similarity: Number((soc?.similarity ?? 0).toFixed(3)),
      comfort: Number((soc?.comfort ?? 0).toFixed(3)),
      gate: Number((att?.gate ?? 0).toFixed(3)),
      focus: Number((att?.focus ?? 0).toFixed(3)),
      salienceNet: Number((att?.salienceNet ?? 0).toFixed(3)),
      arousal: Number((g('brainstem')?.arousal ?? 0).toFixed(3)),
      coupling: Number((g('brainstem')?.coupling ?? 0).toFixed(3)),
      vasopressin: Number((nm?.vasopressin ?? 0).toFixed(3)),
      opioid: Number((nm?.opioid ?? 0).toFixed(3)),
      endocannabinoid: Number((nm?.endocannabinoid ?? 0).toFixed(3)),
      // 这两个是 0~1 信号，不是毫秒。以前直接把 idleMs 塞进来，rate-audit 两分钟就跳 120000。
      fresh: Number(clamp(1 - (Number(dmn?.idleMs ?? 0) / 86400000), 0, 1).toFixed(3)),
      idle: Number(clamp(Number(dmn?.idleMs ?? 0) / 86400000, 0, 1).toFixed(3)),
      anchor: Number((dmn?.anchors ?? 0)),
      chapter: Number((dmn?.chapters ?? 0)),
      sleepGate: Number((hyp?.sleepGate ?? 0).toFixed(3)),
      aggression: Number((hyp?.aggression ?? 0).toFixed(3)),
      count: Number((hip?.count ?? 0).toFixed(3)),
      fastThreat: Number((amy?.fastThreat ?? 0).toFixed(3)),
      novelty: Number((amy?.novelty ?? 0).toFixed(3)),
      ne: Number((amy?.ne ?? 0).toFixed(3)),
      cort: Number((amy?.cort ?? 0).toFixed(3)),
      freeze: Number((amy?.freeze ?? 0).toFixed(3)),
      bodySelf: Number((ins?.bodySelf ?? 0).toFixed(3)),
      bodyBudget: Number((ins?.bodyBudget ?? 0).toFixed(3)),
      ach: Number((nm?.ach ?? 0).toFixed(3)),
      da: Number((nm?.da ?? 0).toFixed(3)),
      serotonin: Number((nm?.serotonin ?? 0).toFixed(3)),
      oxytocin: Number((nm?.oxytocin ?? 0).toFixed(3)),
      testosterone: Number((endo?.testosterone ?? 0).toFixed(3)),
      cortisol: Number((endo?.cortisol ?? 0).toFixed(3)),
      thyroid: Number((endo?.thyroid ?? 0).toFixed(3)),
      weekly: Number((rhy?.weekly ?? 0).toFixed(3)),
      seasonal: Number((rhy?.seasonal ?? 0).toFixed(3)),
      drift: Number((rhy?.drift ?? 0).toFixed(3)),
      hostile: Number((bi?.hostile ?? 0).toFixed(3)),
      // 记仇：关系账本的净重（0..1，长期项）。仪表页/测试看"有没有记着"，不看它压不压心情。
      grudges: Number(clamp(Number(world.grudge ?? 0), 0, 1).toFixed(3)),
      congruent: Number((bi?.congruent ?? 0).toFixed(3)),
    },
    memorySchemas: world.memorySchemas ?? null,
    memorySchemaDebug: world.memorySchemaDebug ?? null,
    memoryRecent: world.memoryRecent ?? null,
    context: world.context ?? null,
    at: world.tx?.t1 ?? 0,
    txId: world.tx?.txId ?? 0,
    candidates,
    meme: io?.meme ?? null,
    stale: world.get('pfc')?.frame !== world.get('io')?.frame,
  }
}












