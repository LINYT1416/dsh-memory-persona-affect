// 因果边：从一段对话里捞出"因为…所以""但是""结果"这三类关系。
// 只在一段 episode 内部连，不跨会话、不跨段 —— 跨段连错的代价比漏掉大。
// 说明：这是规则抽取，不是因果推断。它标的是"话里说了因果"，不是"世界上真存在因果"。

const MAX_EDGES = 5
const MIN_LEN = 6

// 线索词：命中先后顺序有意义，长词优先
const CUES = [
  { type: 'cause', words: ['因为', '由于', '之所以', '导致', '造成了', '所以才', '使得'] },
  { type: 'turn', words: ['但是', '不过', '可是', '结果却', '反而', '没想到', '偏偏'] },
  { type: 'result', words: ['所以', '于是', '最后', '结果', '终于', '后来', '然后'] },
]

/** 切成小句：句末标点 + 逗号都断开。中文的"因为…，所以…"常在同一个句号里。 */
export function splitClauses(text = '') {
  return String(text)
    .split(/[。！？；!?;\n，,、]/)
    .map((x) => x.trim())
    .filter((x) => x.length >= 4)
}

/** 把一段文本切成句子（中英文标点都算） */
export function splitSentences(text = '') {
  return String(text)
    .split(/(?<=[。！？；!?;\n])/)
    .map((s) => s.trim())
    .filter((s) => s.length >= MIN_LEN)
}

/** 判断这一句带了哪类关系词 */
export function cueOf(sentence = '') {
  for (const c of CUES) {
    for (const w of c.words) {
      if (sentence.includes(w)) return { type: c.type, cue: w }
    }
  }
  return null
}

/**
 * 从一段文本里抽出因果/转折/结果关系。
 * 返回 [{ type, cue, from, to }]，from/to 是句子下标（从 0 开始）。
 */
export function buildCausal(text = '', { maxEdges = MAX_EDGES, granularity = 'sentence' } = {}) {
  const sents = granularity === 'clause' ? splitClauses(text) : splitSentences(text)
  const edges = []
  for (let i = 1; i < sents.length; i++) {
    const hit = cueOf(sents[i])
    if (!hit) continue
    edges.push({ type: hit.type, cue: hit.cue, from: i - 1, to: i })
    if (edges.length >= maxEdges) break
  }
  return edges
}

/** 给注入/展示用的一句话（不啰嗦） */
export function causalLine(edges = []) {
  if (!edges.length) return ''
  const order = { cause: '因为', turn: '但是', result: '所以' }
  return edges.slice(0, 2).map((e) => order[e.type] || e.type).join(' / ')
}

/**
 * 跨消息版：把同一段对话里连续的几条消息拼起来再抽。
 * 单条消息常常只有半个因果（"因为…"在你说，"所以…"在我说），
 * 用 。 拼接能保证句子边界，不会把两句话粘成一句。
 */
export function buildCausalFromParts(parts = [], opts = {}) {
  const clean = parts.map((p) => String(p || '').trim()).filter(Boolean)
  if (clean.length < 2) return buildCausal(clean.join('') || '', { granularity: 'clause', ...opts })
  return buildCausal(clean.join('。'), { granularity: 'clause', ...opts })
}
