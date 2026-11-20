// 文本与语义词表：整个插件唯一允许"看字面"的地方。
// 这里只做字面匹配，不做语义判断——语义一律走 seams（cog.*）。
// 对应：P1-1 意图、P1-3 过滤、P3-2 否定、P4-5/6/7 价值代理、P2-8 断言抑制。

export const LATIN = /[a-z0-9_]+/gi

export function norm(s) {
  return String(s ?? '')
    .toLowerCase()
    .replace(/[\u3000]/g, ' ')
    .trim()
}

/** 中文按 2-gram，拉丁按词。只用于字面比对，不用于相似度。 */
export function tokens(s) {
  const t = norm(s)
  const out = new Set()
  for (const m of t.match(LATIN) || []) if (m.length >= 2) out.add(m)
  const cjk = t.replace(/[^\u4e00-\u9fa5]/g, '')
  for (let i = 0; i < cjk.length - 1; i += 1) out.add(cjk.slice(i, i + 2))
  return [...out]
}

export function overlap(a, b) {
  const A = new Set(tokens(a))
  const B = new Set(tokens(b))
  if (!A.size || !B.size) return 0
  let hit = 0
  for (const x of A) if (B.has(x)) hit += 1
  return hit / Math.min(A.size, B.size)
}

// ── 时间词 ────────────────────────────────────────────────
const DAY = 86400000
const WEEKDAY = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 日: 0, 天: 0 }

export function timeRange(q, now = Date.now()) {
  const s = norm(q)
  const d = new Date(now)
  const dayStart = (dt) => new Date(dt.getFullYear(), dt.getMonth(), dt.getDate()).getTime()
  const today = dayStart(d)

  if (/刚才|刚刚|这会儿|马上/.test(s)) return { since: now - 10 * 60000, label: '刚刚' }
  if (/今天/.test(s)) return { since: today, label: '今天' }
  if (/昨天/.test(s)) return { since: today - DAY, until: today, label: '昨天' }
  if (/前天/.test(s)) return { since: today - 2 * DAY, until: today - DAY, label: '前天' }
  if (/这周|本周/.test(s)) return { since: today - ((d.getDay() + 6) % 7) * DAY, label: '这周' }
  if (/上周/.test(s)) {
    const monday = today - ((d.getDay() + 6) % 7) * DAY
    return { since: monday - 7 * DAY, until: monday, label: '上周' }
  }
  if (/这个月|本月/.test(s)) return { since: new Date(d.getFullYear(), d.getMonth(), 1).getTime(), label: '本月' }
  if (/上个月|上月/.test(s)) {
    return {
      since: new Date(d.getFullYear(), d.getMonth() - 1, 1).getTime(),
      until: new Date(d.getFullYear(), d.getMonth(), 1).getTime(),
      label: '上个月',
    }
  }
  if (/最近|近期/.test(s)) return { since: now - 7 * DAY, label: '最近' }
  if (/之前|以前|上次|那次/.test(s)) return { until: now, label: '之前' }

  const m = s.match(/(?:上|这)?(?:周|星期)([一二三四五六日天])/)
  if (m) {
    const target = WEEKDAY[m[1]]
    const dir = /上周/.test(s) ? -1 : 0
    const base = today - ((d.getDay() + 6) % 7) * DAY + dir * 7 * DAY
    const offset = ((target + 6) % 7) * DAY
    return { since: base + offset, until: base + offset + DAY, label: m[0] }
  }
  return null
}

// ── 意图词表 ──────────────────────────────────────────────
const SEQ_ASK = /后来|然后呢|接着呢|之前发生|之后又|接下来呢/
const META_ASK = /你记得|你还记得|你知不知道|有没有记录|我说过吗|你忘了/
const PREF_ASK = /喜欢|讨厌|爱不爱|偏好|想吃|想去/
const FACT_ASK = /是什么|多少|哪年|什么时候|几点|在哪儿|在哪|号码|账号|uid|生日/
const REL_ASK = /关系|跟谁|和谁|谁和谁|怎么认识的/
const GREET = /^(在吗|在么|你好|嗨|hi|哈喽|早|晚安|睡了么|人呢)[\s!！?？。.]*$/i

export function isGreeting(q) {
  return GREET.test(norm(q))
}

export function seqAsk(q) {
  return SEQ_ASK.test(norm(q))
}

export function intentOf(q) {
  const s = norm(q)
  if (!s) return 'empty'
  if (isGreeting(s)) return 'chat'
  if (META_ASK.test(s)) return 'meta'
  if (seqAsk(s)) return 'sequence'
  if (uidLike(s)) return 'fact'
  // 关系要排在"是什么"前面：'我和她是什么关系' 是关系，不是事实
  if (REL_ASK.test(s)) return 'relation'
  if (PREF_ASK.test(s)) return 'preference'
  if (FACT_ASK.test(s)) return 'fact'
  if (timeRange(s)) return 'time'
  return 'episode'
}

/** 精确型：数字串 / 引号 / uid / 账号 —— 走分离模式，不走向量。 */
export function uidLike(q) {
  const s = String(q ?? '')
  return /\d{4,}/.test(s) || /[「『"“]/.test(s) || /uid|账号|号码|id\b/i.test(norm(s))
}

// ── 否定 ──────────────────────────────────────────────────
const NEG = /不是|没有|没|别|不|从未|从没|并没有/
const NEG_SCOPE_END = /[，。！？,.;!?]/

/** 粗判否定：有没有否定词 + 否定词后面的片段（作用域交皮层细化）。 */
export function negation(text) {
  const s = String(text ?? '')
  const m = s.match(NEG)
  if (!m) return null
  const tail = s.slice(m.index + m[0].length)
  const cut = tail.search(NEG_SCOPE_END)
  const scope = (cut >= 0 ? tail.slice(0, cut) : tail).trim()
  if (!scope) return { word: m[0], scope: '', strong: true }
  return { word: m[0], scope, strong: false }
}

/**
 * 极性词：用于"同实体反向"的结构冲突检出。
 * 坑：'不爱吃' 里含 '爱吃'，直接两边匹配会得出"又爱又不爱"。
 * 所以正词要看前一个字是不是否定词，被否定的正词不算正。
 */
export function polarity(text) {
  const s = norm(text)
  const POS = /喜欢|爱吃|想去|爱听|爱看|真好|开心|满意|推荐/g
  let pos = false
  for (const m of s.matchAll(POS)) {
    const before = s.slice(Math.max(0, m.index - 1), m.index)
    if (/[不没别甭]/.test(before)) continue
    pos = true
    break
  }
  const neg = /讨厌|不喜欢|不爱|不想要|烦|难受|生气|失望|避雷/.test(s)
  if (pos && !neg) return 1
  if (neg && !pos) return -1
  return 0
}

// ── 价值代理（等杏仁核之前的估计）─────────────────────────
const REWARD = /想要|期待|终于|盼|等不及|太棒|赚了|成了|搞定/
const SELF = /我|自己|我的|对我/

export function rewardCue(text) {
  return REWARD.test(norm(text)) ? 1 : 0
}

export function selfRef(text) {
  return SELF.test(norm(text)) ? 1 : 0
}

/** 目标相关度：query 词与目标词的重叠。纯字面。 */
export function goalFit(text, goal) {
  if (!goal) return 0
  return overlap(text, goal)
}

// ── 数字与实体 ────────────────────────────────────────────
export function numbersIn(text) {
  return (String(text ?? '').match(/\d+(?:\.\d+)?/g) || []).slice(0, 4)
}

export function uniq(arr) {
  return [...new Set((arr || []).filter(Boolean))]
}

export function clamp(x, lo = 0, hi = 1) {
  return Math.max(lo, Math.min(hi, x))
}

export function round(x, n = 4) {
  const p = 10 ** n
  return Math.round(x * p) / p
}
