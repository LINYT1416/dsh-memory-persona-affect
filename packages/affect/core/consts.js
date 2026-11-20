// 全部共享常量、数学、词表。所有模块只从这里拿，不各自定义。

export const VERSION = '1.0.0'
export const SCHEMA = 1

export const SEC = 1000
export const MIN = 60_000
export const HOUR = 3600_000
export const DAY = 86400_000

export const clamp = (n, a, b) => Math.max(a, Math.min(b, Number.isFinite(n) ? n : a))
export const sat = (x) => 1 - Math.exp(-Math.max(0, x))          // 饱和
export const decay = (dtMs, tauMin) => Math.exp(-(dtMs / MIN) / Math.max(0.001, tauMin))
export const gauss = (x, mu, sd) => Math.exp(-((x - mu) ** 2) / (2 * sd * sd))
export const lerp = (a, b, t) => a + (b - a) * t
export const r3 = (n) => Math.round(n * 1000) / 1000

/** 环绕钟点差 */
export function hourDiff(a, b) {
  const d = Math.abs(a - b) % 24
  return Math.min(d, 24 - d)
}

export function hourOf(t) {
  const d = new Date(t)
  return d.getHours() + d.getMinutes() / 60
}

export function dayKey(t = Date.now()) {
  const d = new Date(t)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** 确定性随机：seed+label+tick → 同一串数 */
export function rng(seed, label = '', tick = 0) {
  let s = (seed ^ hash(label) ^ (tick * 2654435761)) >>> 0
  return () => {
    s = (s + 0x6d2b79f5) >>> 0
    let t = s
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export function hash(str) {
  let h = 2166136261
  const s = String(str)
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

// ── 词表（快路用，纯字符级，不做分词）──
const POS = /棒|厉害|牛|赞|辛苦|谢谢|喜欢|爱你|乖|可爱|不错|佩服|绝了|可以啊|真好|开心|好看|想你|抱|亲/
const NEG = /烦|讨厌|滚|闭嘴|不行|不好|没用|笨|废物|算了|随便|要你管|无语|失望|滚蛋|恶心/
const COLD_ONLY = /^(哦|嗯|随便|都行|算了|行吧|知道了|随你)[。.!！~～]?\s*$/
const APOLOGY = /对不起|抱歉|我错了|是我不对|我刚才不该|别生气|原谅我/
const WARM = /哈|嘿|呀|啦|嘛|抱|亲|贴|暖/

/** 区间里落在"夜里（23~6 点）"的比例，用于睡眠恢复 */
export function nightFraction(t0, t1) {
  if (!(t1 > t0)) return 0
  const step = Math.min(15 * 60_000, Math.max(60_000, (t1 - t0) / 8))
  let n = 0, total = 0
  for (let t = t0; t < t1; t += step) {
    const h = new Date(t).getHours()
    if (h >= 23 || h < 6) n++
    total++
  }
  return total ? n / total : 0
}

export function pragmatics(text) {
  const s = String(text || '')
  const count = (rx) => (s.match(rx) || []).length
  const pos = POS.test(s) ? 1 : 0
  const neg = (NEG.test(s) || COLD_ONLY.test(s)) ? 1 : 0
  return {
    length: Array.from(s).length,
    polarity: pos - neg,
    negation: pos || neg ? 0 : count(/[不没别甭未]/g),
    // "别忘记"是提醒，不是命令
    imperative: /^(快|赶紧|给我|马上|立刻|别(?!忘|记))/.test(s) ? 1 : 0,
    secondPerson: count(/你/g),
    intensifier: count(/[特超巨死极狠贼]/g),
    exclaim: count(/[!！]/g),
    question: count(/[?？]/g),
    ellipsis: count(/[.。…]{2,}/g),
    warm: pos,
    cold: neg,
    warmTone: WARM.test(s) ? 1 : 0,
    apology: APOLOGY.test(s) ? 1 : 0,
    // 空消息/纯表情：信息量低
    thin: Array.from(s).filter(c => /[\u4e00-\u9fa5a-zA-Z0-9]/.test(c)).length <= 2,
  }
}

/** 情绪原型：7 维签名。relevance, goal(-1..1), agencyOther, certainty, coping, norm(-1..1), novelty */
export const PROTOTYPES = [
  { kind: '开心', v: [0.70, 0.90, 0.30, 0.60, 0.60, 0.50, 0.40] },
  { kind: '兴奋', v: [0.80, 0.90, 0.30, 0.50, 0.50, 0.50, 0.80] },
  { kind: '满足', v: [0.50, 0.80, 0.20, 0.80, 0.80, 0.60, 0.30] },
  { kind: '安心', v: [0.60, 0.75, 0.90, 0.80, 0.90, 0.60, 0.20] },
  { kind: '感动', v: [0.80, 0.85, 0.90, 0.70, 0.40, 0.80, 0.50] },
  { kind: '得意', v: [0.60, 0.85, 0.10, 0.90, 0.90, 0.50, 0.50] },
  { kind: '害羞', v: [0.70, 0.65, 0.90, 0.60, 0.30, 0.55, 0.60] },
  { kind: '心动', v: [0.90, 0.90, 0.90, 0.40, 0.30, 0.50, 0.80] },
  { kind: '想念', v: [0.70, 0.80, 0.90, 0.50, 0.20, 0.50, 0.40] },
  { kind: '生气', v: [0.80, -0.70, 0.90, 0.90, 0.60, -0.50, 0.40] },
  { kind: '委屈', v: [0.90, -0.70, 0.90, 0.70, 0.20, -0.40, 0.40] },
  { kind: '失望', v: [0.80, -0.80, 0.90, 0.80, 0.30, -0.20, 0.50] },
  { kind: '难过', v: [0.70, -0.80, 0.40, 0.70, 0.20, 0.00, 0.40] },
  { kind: '心痛', v: [0.90, -0.80, 0.90, 0.60, 0.20, 0.00, 0.30] },
  { kind: '焦虑', v: [0.60, -0.50, 0.40, 0.30, 0.20, 0.00, 0.60] },
  { kind: '紧张', v: [0.50, -0.40, 0.40, 0.40, 0.30, 0.00, 0.60] },
  { kind: '害怕', v: [0.80, -0.80, 0.40, 0.70, 0.10, 0.00, 0.60] },
  { kind: '内疚', v: [0.80, -0.60, 0.20, 0.90, 0.50, -0.60, 0.40] },
  { kind: '羞耻', v: [0.90, -0.70, 0.20, 0.80, 0.20, -0.70, 0.40] },
  { kind: '厌烦', v: [0.50, -0.50, 0.90, 0.80, 0.50, -0.30, 0.30] },
]

export const NEG_KINDS = new Set(['生气', '委屈', '失望', '难过', '心痛', '焦虑', '紧张', '害怕', '内疚', '羞耻', '厌烦'])

/** 质地词表：固定 20 个，不许自由发挥 */
export const TEXTURES = ['紧', '堵', '沉', '空', '热', '凉', '麻', '酸', '胀', '缩', '翻', '轻', '松', '闷', '刺', '跳', '烧', '抖', '硬', '乏']

export const ACTION = {
  生气: '想让他先把话收回去',
  委屈: '想让他主动问一句',
  失望: '不太想解释，想自己待会儿',
  难过: '想一个人缩一会儿',
  心痛: '不想说话',
  厌烦: '想走开',
  焦虑: '想抓住点什么',
  紧张: '想快点结束',
  害怕: '想躲一下',
  开心: '想多说两句',
  兴奋: '想把这事讲给他听',
  满足: '想就这么待着',
  安心: '想赖一会儿',
  感动: '有点想哭，但会忍住',
  得意: '想让他夸一句',
  害羞: '想别过头去',
  心动: '想再听一遍',
  想念: '想找他',
  内疚: '想说句对不起',
  羞耻: '想找个地缝',
}
