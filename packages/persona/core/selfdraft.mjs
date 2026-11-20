// 自我草稿：从"我经历过的事"里长出一段自述草稿。
//
// 两层：
//   1) 选料 + 去噪（只留真事，能对回 episode）
//   2) 语气层：从她自己的写法里估"句长 / 语气词 / 少书面词"，把每条改写成她的节奏
//
// 硬约束：语气层只能动"标点、语气词、断句"，不许加事实。
// 所以每条改写后，剥掉语气词和标点，必须是原话的一部分——可机器校验。

const EMOTION_TAG = '【情绪】'
const TECH_NOISE = /recallSync|BM25|插件|接口|API|函数|日志|tests?\b|memory|regex|bug|报错|编译|重启|部署|器官|\.js\b|\.mjs\b/i
const FILLER_HEAD = /^(?:我还想问的就是[，,]?|然后呢?[，,]?|那个[，,]?|就是说[，,]?|其实[，,]?)/
const PARTICLES = ['啊', '呀', '啦', '嘛', '哦', '诶', '嗯']
const BOOKISH = /(?:因此|从而|并且|然而|此外|综上|进行|予以|之|其)/

const isNoise = (t) => {
  if (!t) return true
  if (t.startsWith(EMOTION_TAG)) return true
  if (t.length < 8) return true
  if (/^(?:ok|OK|嗯|好|收到|test|tests)$/.test(t.trim())) return true
  if (TECH_NOISE.test(t)) return true
  return false
}

const clean = (s) => String(s || '')
  .replace(/\s+/g, ' ')
  .trim()
  .replace(FILLER_HEAD, '')
  .replace(/[。，,；;]+$/g, '')

const dot = (s) => {
  const t = String(s || '').trim()
  return /[。！？!?]$/.test(t) ? t : t + '。'
}

const hash = (s) => {
  let h = 2166136261
  for (const ch of String(s)) { h ^= ch.codePointAt(0); h = Math.imul(h, 16777619) }
  return (h >>> 0) / 4294967296
}

/** 从她自己的文字里估说话习惯；支持 {text, at} 并做时间加权（半衰期 30 天） */
export function estimateStyle(samples = [], { now = Date.now(), halfLifeDays = 30 } = {}) {
  const rows = (samples || [])
    .map((x) => (typeof x === 'string' ? { text: x, at: 0 } : { text: String(x?.text ?? ''), at: Number(x?.at) || 0 }))
    .filter((x) => x.text.trim().length >= 4)
  if (!rows.length) return { avgLen: 14, particleRate: 0.35, exclaimRate: 0.1, bookish: 0, n: 0, weighted: 0 }

  let wSum = 0
  let charsW = 0
  let sentsW = 0
  let partW = 0
  let exclaimW = 0
  let bookW = 0
  for (const row of rows) {
    const ageDays = row.at > 0 ? Math.max(0, (now - row.at) / 86_400_000) : halfLifeDays
    const w = Math.max(0.05, Math.pow(0.5, ageDays / halfLifeDays))
    const parts = row.text.split(/[。！？!?；;\n]+/).filter((x) => x.trim())
    const nParts = Math.max(1, parts.length)
    wSum += w
    charsW += Array.from(row.text).length * w
    sentsW += nParts * w
    if (PARTICLES.some((p2) => row.text.includes(p2))) partW += w
    if (/[！!]/.test(row.text)) exclaimW += w
    if (BOOKISH.test(row.text)) bookW += w
  }
  return {
    avgLen: charsW / Math.max(1, sentsW),
    particleRate: Math.min(1, partW / Math.max(0.0001, wSum)),
    exclaimRate: Math.min(1, exclaimW / Math.max(0.0001, wSum)),
    bookish: Math.min(1, bookW / Math.max(0.0001, wSum)),
    n: rows.length,
    weighted: wSum,
  }
}

/**
 * 把一句话改写成她的节奏：只在标点/语气词/断句上动，不加事实。
 * @returns {string} 改写后的句子（不带句号）
 */
export function styleLine(text, style = {}, seed = 0) {
  let s = clean(text)
  if (!s) return ''
  // 书面词换口语（只做等价替换，不增信息）
  s = s.replace(/因此/g, '所以').replace(/此外/g, '还有').replace(/并且/g, '而且')
  // 太长就断：在她的平均句长附近切一刀（只切逗号处，不拆词）
  const avg = Number(style.avgLen) > 0 ? Number(style.avgLen) : 14
  const arr = Array.from(s)
  if (arr.length > avg * 1.6 && s.includes('，')) {
    const parts = s.split('，')
    const head = parts.shift()
    s = head + '，' + parts.join('，')
  }
  // 语气词：按她的频率挂一个（确定性，不用随机）
  const rate = Number.isFinite(style.particleRate) ? style.particleRate : 0.35
  const r = hash(s + '#' + seed)
  if (r < rate && !new RegExp('[' + PARTICLES.join('') + ']$').test(s)) {
    s += PARTICLES[Math.floor(hash(s) * PARTICLES.length)]
  }
  return s
}

/** 去掉语气词和标点：用来校验"改写没加事实" */
export function bareOf(line) {
  return String(line || '')
    .replace(/^-\s*/, '')
    .replace(/^我记得[，,]?/, '')
    .replace(/[，,。！？!?；;、\s]/g, '')
    .replace(new RegExp('[' + PARTICLES.join('') + ']', 'g'), '')
}

/** 从 episode 里挑出"能代表她自己的事"：近、长、含人 */
export function pickSelfEvents(episodes = [], { max = 6 } = {}) {
  const rows = (episodes || [])
    .map((e, i) => ({
      i,
      id: String(e?.episodeId || e?.id || e?.key || `ep-${i}`),
      text: clean(e?.brief || e?.summary || e?.text || ''),
      at: Number(e?.at || e?.start || 0),
    }))
    .filter((r) => r.text && !isNoise(r.text))
    .sort((a, b) => (b.at - a.at) || (b.i - a.i))

  const kept = []
  for (const r of rows) {
    const dup = kept.findIndex((k) => k.text.includes(r.text) || r.text.includes(k.text))
    if (dup >= 0) {
      if (r.text.length > kept[dup].text.length) kept[dup] = r
      continue
    }
    kept.push(r)
    if (kept.length >= max) break
  }
  return kept
}

/**
 * 生成草稿：第一人称，只陈述"经历过的事实"，按她的语气说。
 * @returns {{text:string, used:Array<{id:string,text:string,line:string}>, empty:boolean, style:object}}
 */
export function draftSelf(episodes = [], { max = 6, style = true, selfText = '', samples = [] } = {}) {
  const events = pickSelfEvents(episodes, { max })
  // 风格样本优先用她自己的原话；没有才退回手写自述（都没有就是中性默认）
  const pool = Array.isArray(samples) && samples.length ? samples : [selfText]
  const st = estimateStyle(pool)
  if (!events.length) {
    return { text: '', used: [], empty: true, style: st, note: '没有可用的经历，写不出草稿——先攒点真的对话' }
  }
  const used = []
  const lines = events.map((e, i) => {
    const say = style ? styleLine(e.text, st, i) : clean(e.text)
    const line = style ? `- 我记得，${dot(say)}` : `- ${dot(say)}`
    used.push({ id: e.id, text: e.text, line })
    return line
  })
  const text = [
    '我这些年，记下来的事大概是这样：',
    ...lines,
    '这些是我确实遇上的，不是我想出来的；没列进来的，我也不会硬说记得。',
  ].join('\n')
  return { text, used, empty: false, style: st }
}
