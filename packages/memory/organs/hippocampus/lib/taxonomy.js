// 语义零件：分词、实体、类型、场所、显著性、编码门、编码深度、结果信号。
// 这些本该由皮层/杏仁核/前额叶给，单器官阶段先按规则打桩（E2/E3/E11 的默认实现）。
// 对应功能总表：L1-5 膨胀展开、L1-11 双通道、L2-6 地点、L2-15 置信度、L5-4 显著性、L4-14 结果信号。

// ── 分词：中文二元组 + 英文/数字词 ──────────────────────────────
const STOP = new Set([
  '的', '了', '是', '在', '有', '和', '与', '就', '都', '也', '还', '要', '会', '能', '把',
  '被', '给', '让', '对', '从', '到', '跟', '向', '为', '以', '及', '或', '但', '而', '却',
  '我', '你', '他', '她', '它', '我们', '你们', '他们', '这', '那', '这么', '那么', '什么',
  '怎么', '为什么', '因为', '所以', '但是', '然后', '现在', '刚才', '已经', '一下', '一个',
  '这个', '那个', '可以', '不是', '就是', '还是', '这样', '那样', '不过', '然后', '而且',
])

export function tokenize(text) {
  // 中英混排先归一：文本里写「B 站」、查询里写「B站」，去空格后才能切到同一个 token
  let s = String(text || '').toLowerCase().replace(/\s+/g, '')
  const out = new Map()
  const push = (t) => {
    if (!t || STOP.has(t)) return
    out.set(t, (out.get(t) || 0) + 1)
  }

  // 否定词先摘出来单独成一个 token，不然「不喜欢鲸鱼」会切出「喜欢」，
  // 查询「不喜欢什么」就会命中一堆「喜欢 X」。
  // 「不太喜欢 / 不怎么喜欢 / 没那么喜欢」这些也要算否定词。
  const negs = []
  s = s.replace(/不(?:太|怎么|那么|是那么)?(喜欢|想要|爱吃|爱用|爱看|接受|忍|爱|想|要|会|能|对|行|好|用)/g, (_m, w) => {
    negs.push(`¬${w}`)
    return ' '
  })
  for (const n of negs) push(n)

  // 负面说法不靠「不」字也要认：太生硬 / 难听 / 受不了 / 烦……
  // 统一打一个 ¬负面，否则「她不喜欢什么」召不回「音色太生硬」。
  for (const w of NEGATIVE) {
    if (s.includes(w)) { push('¬负面'); break }
  }

  // 混排词：b站 / qq机器人 / 1000003
  for (const m of s.matchAll(/[a-z0-9_]+[\u4e00-\u9fa5]{1,4}/g)) push(m[0])
  for (const m of s.matchAll(/[a-z0-9_]{2,}/g)) push(m[0])
  const han = s.replace(/[^\u4e00-\u9fa5]+/g, ' ')
  for (const seg of han.split(' ')) {
    if (!seg) continue
    if (seg.length === 1) { push(seg); continue }
    for (let i = 0; i < seg.length - 1; i++) push(seg.slice(i, i + 2))
  }
  return out
}

export function docLen(tokens) {
  let n = 0
  for (const v of tokens.values()) n += v
  return n
}

// ── 实体：中文 2–4 字片段、英文词、数字串、@/#/引号 ─────────────
const ENTITY_STOP = new Set([
  ...STOP,
  '东西', '事情', '时候', '地方', '今天', '明天', '昨天', '现在', '最近', '这样', '那样',
  '感觉', '觉得', '知道', '看到', '听到', '说了', '就是', '不是', '可以', '应该', '需要',
  '帮我', '给你', '我们', '你们', '他们', '自己', '大家', '真的', '非常', '特别', '有点',
])

export function extractEntities(text, limit = 12) {
  const s = String(text || '')
  const bag = new Map()
  const bump = (w, weight = 1) => {
    if (!w) return
    const key = w.toLowerCase()
    bag.set(key, (bag.get(key) || 0) + weight)
  }

  // @某人 / #话题 / 「引号」
  for (const m of s.matchAll(/@([^\s@]{1,20})/g)) bump(m[1], 3)
  for (const m of s.matchAll(/#([^\s#]{1,20})/g)) bump(m[1], 3)
  for (const m of s.matchAll(/[「『"“]([^」』"”]{1,20})[」』"”]/g)) bump(m[1], 2)
  // 数字串（uid、号码、日期、金额）
  for (const m of s.matchAll(/\d{4,}/g)) bump(m[0], 3)
  for (const m of s.matchAll(/\d{1,3}(?:\.\d+)?(?:%|元|块|岁|天|分钟|小时|公里|kg|cm)?/g)) bump(m[0], 1)
  // 英文/型号
  for (const m of s.matchAll(/[A-Za-z][A-Za-z0-9_.+-]{1,}/g)) bump(m[0], 2)

  // 中文片段：按标点/空白切开，再取 2–4 字滑窗
  const han = s.replace(/[^\u4e00-\u9fa5]+/g, ' ')
  for (const seg of han.split(' ')) {
    if (seg.length < 2) continue
    if (seg.length <= 4) { bump(seg); continue }
    for (let i = 0; i < seg.length - 1; i++) bump(seg.slice(i, i + 2))
    for (let i = 0; i < seg.length - 2; i++) bump(seg.slice(i, i + 3))
  }

  // 滑窗产物里一半是"了几句""句话"这种碎片，它们不是实体，留着只会让检索添噪。
  // 规则：2 字里含虚词或量词 → 丢；3 字里虚词/量词占两个 → 丢。
  const FILLER_CH = '了的着过是在有没就都又也还很太会能要个些吗呢吧啊嗯哦呀嘛你我他她它们这那上下里外中几件次点样种步'
  const FILLER = new RegExp(`[${FILLER_CH}]`, 'u')
  const FILLER_G = new RegExp(`[${FILLER_CH}]`, 'gu')
  return [...bag.entries()]
    .filter(([w]) => !ENTITY_STOP.has(w) && w.length >= 2)
    .filter(([w]) => {
      if (w.length === 2) return !FILLER.test(w)
      if (w.length === 3) return (w.match(FILLER_G) || []).length < 2
      return true
    })
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([w]) => w)
}

// ── 场所（L1-11 的 scene 通道、L2-6 地点）────────────────────────
const PLACES = [
  '家', '家里', '宿舍', '公司', '工位', '办公室', '学校', '教室', '图书馆', '实验室',
  '地铁', '公交', '车站', '机场', '火车', '路上', '楼下', '小区', '超市', '便利店',
  '咖啡', '咖啡馆', '奶茶', '餐厅', '食堂', '饭馆', '火锅', '酒吧', '医院', '药店',
  '公园', '海边', '山上', '健身房', '球场', '电影院', '商场', '书店', '酒店', '房间',
  // 日常待得最多的地方：家里分房间才算"在哪做的"
  '卧室', '客厅', '厨房', '卫生间', '浴室', '阳台', '沙发', '床上', '桌前', '会议室',
]

export function detectPlace(text) {
  const s = String(text || '')
  for (const p of PLACES) if (s.includes(p)) return p
  return ''
}

// ── 类型：事实 / 计划 / 事件 / 偏好 / 关系 / 情绪 / 技能 / 未知 ────
const TYPE_RULES = [
  ['事实', /uid|账号|帐号|号码|编号|生日|邮箱|身份证|住在|老家|名字|昵称|叫什么|是.{0,6}(人|生|届)/i],
  ['计划', /明天|下周|周末|待会|稍后|计划|打算|准备|要去|约好|安排|到时候|回头|下次/],
  ['偏好', /喜欢|讨厌|偏好|爱吃|不爱|最怕|受不了|爱看|爱听|迷上/],
  ['关系', /妈妈|爸爸|朋友|同事|老婆|老公|男朋友|女朋友|师兄|师姐|老板|室友|同学/],
  ['情绪', /开心|难过|烦|累|崩|爽|慌|焦虑|委屈|生气|失望|兴奋|紧张/],
  ['技能', /会做|学会|掌握了|能修|能写|能画|程序|代码|建模|仿真|调试/],
  ['事件', /今天|刚才|刚刚|昨天|上午|下午|晚上|这次|那次|去了|吃了|见了|买了/],
]

export function detectType(text) {
  const s = String(text || '')
  for (const [type, re] of TYPE_RULES) if (re.test(s)) return type
  return '未知'
}

// ── 显著性：杏仁核桩（E2）。规则分，返回带 source ────────────────
export function salience(text, meta = {}) {
  const s = String(text || '')
  let score = 0.25
  if (/uid|账号|号码|生日|邮箱|身份证/i.test(s)) score += 0.45
  if (/记住|别忘|一定|务必|答应|约好|承诺/i.test(s)) score += 0.3
  if (/喜欢|讨厌|最怕|受不了|过敏/i.test(s)) score += 0.25
  if (/\d{6,}/.test(s)) score += 0.2
  if (/[？！]{2,}|啊啊|卧槽|笑死|气死/.test(s)) score += 0.15
  if (s.length > 120) score += 0.05
  if (meta.fromUser) score += 0.1
  if (/^(嗯|哦|好|行|可以|收到|ok|OK)$/.test(s.trim())) score -= 0.2
  return { score: Math.max(0, Math.min(1, score)), source: 'rule' }
}

// ── 编码门：前额叶桩（E11）。默认：寒暄不过，其余过 ──────────────
export function shouldRemember(text) {
  const s = String(text || '').trim()
  if (!s) return false
  if (s.length < 2) return false
  if (/^(嗯+|哦+|啊+|好+|行+|可以|收到|ok|OK|在吗|早|晚安|晚安啦)[啊呀呢吧〜~！!。.…]*$/.test(s)) return false
  return true
}

// ── 编码深度：杏仁核分数分档（L1-8）────────────────────────────
export function depthOf(score) {
  const v = Number(score) || 0
  if (v >= 0.65) return 'deep'   // 建索引 + 图边
  if (v >= 0.35) return 'standard' // 建索引
  return 'shallow'               // 只落 raw（L1-4 稀疏门）
}

// ── 结果信号：什么算一次“结果”（L4-14 反向重放的触发）──────────
const RESULT_PATTERNS = [
  /搞定了|弄好了|做完了|完成了|成了|跑通了|通过了|过了|拿下了|交了|上线了|发过去了/,
  /终于|总算|可算/,
  /失败了|没过|挂了|崩了|黄了/,
]

export function detectResult(text) {
  const s = String(text || '')
  for (const re of RESULT_PATTERNS) if (re.test(s)) return true
  return false
}

// ── 因果/转折/结果连接词（L2-4 三类候选边）─────────────────────
const REL_WORDS = {
  cause: ['因为', '所以', '因此', '导致', '以至于', '于是', '结果'],
  turn: ['但是', '不过', '可是', '然而', '反而', '没想到', '结果却'],
  result: ['最后', '终于', '结果', '最终', '总算'],
}

export function detectRelations(text) {
  const s = String(text || '')
  const out = []
  for (const [kind, words] of Object.entries(REL_WORDS)) {
    for (const w of words) if (s.includes(w)) { out.push({ kind, word: w }); break }
  }
  return out
}

// ── 负面说法（不靠「不」字）───────────────────────────────────
const NEGATIVE = [
  '太生硬', '生硬', '太丑', '难看', '难听', '难用', '太卡', '卡顿', '太慢', '太吵', '太贵',
  '烦人', '讨厌', '受不了', '不行', '垃圾', '糟糕', '失望', '恶心', '太麻烦', '麻烦死了',
  '不喜欢', '受不了', '不能用', '莫名其妙',
]

// ── 测试数据识别（测完要能查，但平时别来抢座次）─────────────────
const TEST_MARKS = [
  /【测试】/, /【链路测试】/, /测试[:：]/, /（可删）/, /\(可删\)/,
  /测试数据/, /链路测试/, /^测试/, /^test[:：]/i, /^\[test\]/i,
]

export function isTestText(text) {
  const s = String(text || '').trim()
  if (!s) return false
  return TEST_MARKS.some((re) => re.test(s))
}

// ── 关键词：token 高频前 N ──────────────────────────────────────
export function keywords(text, limit = 8) {
  return [...tokenize(text).entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([t]) => t)
    .filter((t) => t.length >= 2)
    .slice(0, limit)
}
