// 注入文本：给模型的是线索，不是剧本。
// 硬规则（写在代码里，不靠自觉）：
//   1. 只写状态，不写具体往事
//   2. 不写数值
//   3. 不写"应该"
//   4. 每轮必须变（相似度 >0.8 换说法或删行）
//   5. 状态弱时只写一行
//   6. 缺器官就不写那一行

const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, Number.isFinite(n) ? n : lo))

// ── 第一行的变体池：按心情强度分档，同一档里轮换，避免每轮同一句 ──
const FIRST_LINES = {
  low: ['这会儿有点沉，提不太起劲。', '这会儿没什么力气，话会少。', '这会儿心里发闷，不太想动。'],
  flat: ['这会儿还行，平平的。', '这会儿没什么特别的。', '这会儿挺平静的。'],
  high: ['这会儿心里挺亮的。', '这会儿状态不错，想多说两句。', '这会儿心情好，看什么都顺眼。'],
}

// ── 情绪 → 一个具体的动作倾向（不是台词，是冲动） ──
const TENDENCY = {
  开心: '想多说两句，想把这点高兴分出去',
  兴奋: '想马上说，等不了',
  满足: '想就这么待着，不想被打断',
  安心: '想靠近一点',
  感动: '想说点什么又怕说重了',
  得意: '想被看见，想被夸一句',
  害羞: '想岔开话题',
  心动: '想多看他一眼，又怕被发现',
  想念: '想找个由头找他说话',
  生气: '想怼回去，不想先低头',
  委屈: '想让他先补一句',
  失望: '想收回一点期待',
  难过: '想一个人待一会儿',
  心痛: '想把自己缩起来',
  焦虑: '想抓住点什么确定的东西',
  紧张: '想快点结束这段对话',
  害怕: '想躲一下',
  内疚: '想补救，又不知道从哪开口',
  羞耻: '想消失一会儿',
  厌烦: '想离远点',
}

// ── 雷区：这会儿别做什么 ──
const NO_GO = {
  委屈: '讲道理',
  生气: '让我"冷静一下"',
  难过: '强行安慰',
  焦虑: '催我做决定',
  害怕: '逼我面对',
  羞耻: '当众提这件事',
  内疚: '追加责备',
}

const TONE_WORD = {
  soft: '语气会软下来，话多一点',
  normal: '正常说话，不端不装',
  hard: '话会短，带一点刺',
  flat: '话很平，不太想接',
}

const QUALITY_PHRASE = {
  紧: '发紧', 堵: '堵着', 沉: '发沉', 空: '发空', 热: '发热',
  冷: '发凉', 麻: '发麻', 酸: '发酸', 胀: '发胀', 抖: '有点抖',
}

function pickByIndex(list, seed) {
  if (!list.length) return ''
  const i = Math.abs(Math.floor(seed)) % list.length
  return list[i]
}

/** 中文 bigram 集合，够用且不用分词 */
function bigrams(text) {
  const clean = String(text).replace(/[\s，。、；：！？,.;:!?"'（）()【】\[\]]/g, '')
  const out = new Set()
  for (let i = 0; i < clean.length - 1; i++) out.add(clean.slice(i, i + 2))
  return out
}

export function similarity(a, b) {
  if (!a || !b) return 0
  const A = bigrams(a)
  const B = bigrams(b)
  if (!A.size || !B.size) return 0
  let inter = 0
  for (const g of A) if (B.has(g)) inter++
  return inter / (A.size + B.size - inter)
}

function bodyLine(body) {
  if (!body || body.intensity < 0.08 || !body.qualities?.length) return ''
  const q = body.qualities.slice(0, 2).map(x => QUALITY_PHRASE[x] || x).join('、')
  const loc = body.location ? `${body.location}` : '身上'
  return `身体：${loc}${q}。`
}

/**
 * 生成注入文本。
 * @param {object} state 融合后的此刻
 * @param {object} persona 人格参数
 * @param {object} prev { text, firstLine } 上一轮的结果，用于去重
 */
export function buildInject(state, persona, prev = {}) {
  const lines = []
  const mood = state.mood ?? 0
  const valence = state.valence ?? 0
  const emotion = state.emotions?.[0]
  const intensity = emotion?.intensity ?? 0

  // 强度档：决定第一行 + 要不要写"心里"
  const band = valence > 0.22 || (mood > 0.2 && intensity > 0.2) ? 'high'
    : valence < -0.22 || (mood < -0.2 && intensity > 0.2) ? 'low'
      : 'flat'

  // 第一行：永远有。轮换池，prev 用过哪句就跳过。
  const pool = FIRST_LINES[band]
  let first = pool[0]
  for (const candidate of pool) {
    if (candidate !== prev.firstLine) { first = candidate; break }
  }
  lines.push(first)

  const weak = band === 'flat' && intensity < 0.12 && (state.body?.intensity ?? 0) < 0.12
  if (weak) return { text: lines.join('\n'), lines, band, firstLine: first }

  // 心里：有明确情绪才写
  if (emotion && intensity >= 0.15) {
    const mixed = emotion.mixed?.filter(m => m.intensity >= 0.12).slice(0, 2) || []
    const mixedText = mixed.length ? `，掺着一点${mixed.map(m => m.kind).join('和')}` : ''
    const p = state.prior
    const clear = p && p.hits > 0 && p.confidence > 0.45
      ? '，说不清是冲这件事还是冲以前的'
      : ''
    lines.push(`心里：${emotion.kind}${mixedText}${clear}。`)
  }

  // 身体：岛叶有质地才写
  const body = bodyLine(state.body)
  if (body) lines.push(body)

  // 嘴上：PFC 有 display 才写
  if (state.display && state.display.toneShift) {
    const bits = []
    if (state.display.toneShift === 'soft') bits.push(TONE_WORD.soft)
    else if (state.display.toneShift === 'hard') bits.push('话会短，带一点刺')
    else if (state.display.toneShift === 'flat') bits.push('话很平，不太想接')
    else bits.push(TONE_WORD.normal)

    if (state.display.brevity > 0.65) bits.push('不会展开说')
    else if (state.display.brevity < 0.2) bits.push('会多说两句')

    if (state.display.leakRisk > 0.5) bits.push('嘴上说没事，语气还是漏出来')
    else if (state.display.leakRisk > 0.25) bits.push('有点藏不住')

    if (bits.length) lines.push(`嘴上：${bits.join('；')}。`)
  }

  // 想做的：有明确情绪给一个具体冲动
  if (emotion && intensity >= 0.3) {
    const tend = TENDENCY[emotion.kind]
    if (tend) lines.push(`想做的：${tend}。`)
  }

  // 这会儿别：最多两条
  const noGo = []
  if (state.display?.leakRisk > 0.45) noGo.push('讲道理')
  if (emotion && NO_GO[emotion.kind]) noGo.push(NO_GO[emotion.kind])
  if (state.appraisal?.coping < 0.3) noGo.push('催我马上做决定')
  const unique = [...new Set(noGo)].slice(0, 2)
  if (unique.length) lines.push(`这会儿别：${unique.join('、')}。`)

  // 旧事：真想起时，只说"好像也这样"，不写具体
  if (state.prior?.hits > 0 && state.prior.confidence > 0.55) {
    lines.push('旧事：上次好像也这样，细节记不清了。')
  }

  // 行数上限：超过就砍中间（身体优先保留），最小两行
  const max = clamp(persona.injectMaxLines ?? 7, 2, 12)
  while (lines.length > max) {
    const idx = lines.findIndex(l => l.startsWith('想做的：') || l.startsWith('旧事：'))
    if (idx > 0) lines.splice(idx, 1)
    else lines.splice(lines.length - 2, 1)
  }

  let text = lines.join('\n')

  // 每轮必须变：跟上一轮太像就换第一行，再不行删一行
  if (prev.text && similarity(text, prev.text) > 0.8) {
    for (const candidate of pool) {
      if (candidate !== first && candidate !== prev.firstLine) {
        lines[0] = candidate
        break
      }
    }
    text = lines.join('\n')
    if (similarity(text, prev.text) > 0.8 && lines.length > 2) {
      const dropIdx = lines.findIndex(l => l.startsWith('想做的：'))
      if (dropIdx > 0) lines.splice(dropIdx, 1)
      else lines.splice(lines.length - 1, 1)
      text = lines.join('\n')
    }
  }

  return { text, lines, band, firstLine: lines[0] }
}
