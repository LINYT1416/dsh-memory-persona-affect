// 情绪解析：我自己的，和对方的。这是两套，不能混（A0-3 / A0-4）。
// 对应文档：4.2 情绪唤醒、4.6 识别恐惧表情、4.7 损伤表。

const POS_WORDS = [
  '开心', '高兴', '爽', '舒服', '喜欢', '太好了', '棒', '赞', '好耶', '舒服',
  '笑死', '乐死', '好玩', '期待', '兴奋', '满足', '幸福', '香', '好香', '爱',
]
const NEG_WORDS = [
  '难过', '烦', '累', '崩', '慌', '焦虑', '委屈', '生气', '气死', '失望',
  '恶心', '讨厌', '难受', '疼', '痛', '糟', '倒霉', '破', '妈的', '靠',
  // 压力与失能：之前漏了，导致"被裁员"跟"买包子"同分
  '懵', '麻', '木', '僵', '压力', '紧张', '不安', '憋', '闷', '扛不住',
  '撑不住', '受不了', '崩溃', '绝望', '无助', '失眠', '睡不着', '烦死',
  // 被占便宜的说法：以前这些句子在学习层被判"没情绪"，恐惧学不起来。
  // 「中介收钱跑路」「房东赖账不退押金」在生活里都是会被记住的事。
  '恨', '被骗', '跑路', '失联', '赖账', '甩锅', '坑了', '骗钱',
]
// 躯体信号：CeA 的表达通道，也是"这件事真的压到我了"的证据
const BODY_WORDS = [
  '出汗', '手心出汗', '心跳', '心慌', '发抖', '手抖', '腿软', '喘不上气',
  '胸闷', '头晕', '胃疼', '头疼', '失眠', '睡不着', '吃不下', '没胃口',
]
const FEAR_WORDS = ['怕', '害怕', '恐怖', '吓', '不敢', '紧张', '心慌', '担心', '发怵', '瑟瑟']
const SAD_WORDS = ['难过', '想哭', '哭', '失落', '委屈', '低落', '难受', '丧', '心酸', '遗憾']
const ANGRY_WORDS = ['生气', '气死', '烦死', '火大', '怒', '骂', '滚', '闭嘴', '受够', '忍不了']

const INTENSIFIERS = ['特别', '超级', '非常', '极其', '太', '巨', '贼', '死', '爆']

function hits(text, words) {
  const s = String(text || '')
  const out = []
  for (const w of words) if (s.includes(w)) out.push(w)
  return out
}

/** 唤醒度：叹号、重复、脏话、长度、叠字。0..1。 */
export function arousalOf(text) {
  const s = String(text || '')
  if (!s) return 0
  let a = 0.15
  const excl = (s.match(/[！!]/g) || []).length
  a += Math.min(0.35, excl * 0.12)
  const q = (s.match(/[？?]/g) || []).length
  a += Math.min(0.15, q * 0.05)
  // 连续重复字符（啊啊啊 / 哈哈哈）
  if (/(.)\1{2,}/.test(s)) a += 0.15
  // 全大写英文
  if (/[A-Z]{3,}/.test(s)) a += 0.08
  // 长句
  if (s.length > 80) a += 0.08
  // 强情绪词
  if (hits(s, ['啊啊', '卧槽', '我靠', '笑死', '气死', '崩溃']).length) a += 0.2
  // 躯体信号：出汗、心跳、失眠——身体先反应了，才是最真的"这事压到我了"
  const body = hits(s, BODY_WORDS)
  if (body.length) a += Math.min(0.35, body.length * 0.15)
  // 叠字加强
  if (hits(s, INTENSIFIERS).length) a += 0.1
  return clamp(a, 0, 1)
}

/**
 * 利害（A1-8）：这件事威胁到生存/位置/关系吗。
 * 这不是"攻击性"（那是 threat），是"筹码有多重"。
 * 之前缺了这个因子，"要裁员"和"买包子"同分。
 */
const STAKES = [
  {
    level: 'high',
    score: 0.30,
    re: /裁员|被裁|裁人|砍人|辞退|开除|失业|欠债|欠钱|还不上|破产|生病|手术|住院|化疗|确诊|离婚|分手|去世|死了|车祸|官司|起诉|赔偿|跑路|赔钱|被优化/,
  },
  {
    level: 'mid',
    score: 0.18,
    re: /面试|考核|绩效|转正|升职|加薪|降薪|调岗|述职|汇报|房租|搬家|体检|吵架|冷战|闹翻|借钱|谈话|约谈|背锅|扣钱/,
  },
  {
    level: 'low',
    score: 0.08,
    re: /加班|赶工|截止|deadline|考试|论文|答辩|报表|上线|通宵/,
  },
]

export function stakeOf(text) {
  const s = String(text || '')
  for (const tier of STAKES) {
    const m = s.match(tier.re)
    if (m) return { level: tier.level, score: tier.score, hit: m[0] }
  }
  return { level: 'none', score: 0, hit: null }
}

/** 我自己的情绪：极性、唤醒、类别。 */
export function parseSelf(text) {
  const s = String(text || '')
  const pos = hits(s, POS_WORDS)
  const neg = hits(s, NEG_WORDS)
  const raw = pos.reduce((n, w) => n + (s.includes(`不${w}`) ? -1 : 1), 0)
    - neg.length
  const polarity = clamp(raw / 3, -1, 1)
  const arousal = arousalOf(s)
  let category = 'neutral'
  if (hits(s, FEAR_WORDS).length) category = 'fear'
  else if (hits(s, ANGRY_WORDS).length) category = 'angry'
  else if (hits(s, SAD_WORDS).length) category = 'sad'
  else if (pos.length && !neg.length) category = 'happy'
  else if (neg.length) category = 'down'

  const degraded = []
  if (!s) degraded.push('empty')

  return {
    polarity: Number(polarity.toFixed(3)),
    arousal: Number(arousal.toFixed(3)),
    category,
    hits: { pos, neg },
    degraded,
  }
}

/**
 * 对方的情绪。注意：这里判的是"对方在怕/难过/生气"，
 * 不是"我感受到什么"。缺了它做不了共情（A0-4）。
 */
export function parseOther(text) {
  const s = String(text || '')
  const fear = hits(s, FEAR_WORDS)
  const sad = hits(s, SAD_WORDS)
  const angry = hits(s, ANGRY_WORDS)

  const score = {
    fear: Math.min(1, fear.length * 0.45),
    sad: Math.min(1, sad.length * 0.4),
    angry: Math.min(1, angry.length * 0.45),
  }
  // 第一人称 + 情绪词，才更像"对方在说自己的状态"
  const firstPerson = /我|俺|咱/.test(s)
  const conf = firstPerson ? 0.75 : 0.45

  const top = Object.entries(score).sort((a, b) => b[1] - a[1])[0]
  return {
    fear: Number(score.fear.toFixed(3)),
    sad: Number(score.sad.toFixed(3)),
    angry: Number(score.angry.toFixed(3)),
    top: top[1] > 0 ? top[0] : null,
    confidence: top[1] > 0 ? Number((conf * Math.min(1, top[1] * 1.5)).toFixed(3)) : 0,
    degraded: top[1] > 0 ? [] : ['no_other_emotion'],
  }
}

/**
 * 倒 U：极端唤醒。返回三量调整（A1-7）。
 * 文档：极高唤醒损害的是"细节"，不是"这件事不重要"。
 */
export function extremeOf(arousal) {
  const a = Number(arousal) || 0
  if (a <= 0.9) return { extreme: false, salDelta: 0, confDelta: 0, details: 'normal' }
  return {
    extreme: true,
    salDelta: -0.05,
    confDelta: -0.3,
    details: 'sparse',
    why: 'arousal>0.9',
  }
}

export function clamp(n, lo, hi) {
  return Math.max(lo, Math.min(hi, Number(n) || 0))
}
