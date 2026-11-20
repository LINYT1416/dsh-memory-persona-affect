// 对话上下文：她说的是问句、在抱怨、在赶时间、在夸我，还是在闲聊。
// 只做粗分类，不假装懂语义——但比"只看这一句"强很多。

const RUSH = /快点|赶紧|来不及|马上|急着|没时间|赶时间|先这样|回头说/
const COMPLAINT = /烦死|真烦|好烦|烦|累死|崩溃|受不了|又崩|又错|气死|无语|服了|怎么又|白干|不想干|心累|不爽/
const QUESTION = /[?？]|吗|呢|怎么|为什么|为啥|是不是|能不能|要不要|哪个|多少/
const PRAISE = /厉害|棒|牛|谢谢|辛苦|喜欢你|爱你|好乖|可爱|佩服|好多了|舒服|做得?很?好|帮了大?忙|没白|多亏|靠谱|我说重了|对不起|抱歉|不是你的错|别往心里去|辛苦你了/
// 直接冲她来的难听话（不是"我自己烦"，是"在骂她"）。
// 技术词先排除掉，别把"垃圾回收"当成骂人。
const INSULT = /垃圾|废物|蠢|闭嘴|没用|烂|离谱|白痴|傻[逼x]?|滚|干的什么|做的什么|重写|又来|搞砸|行不行啊/
const TECH_SAFE = /垃圾回收|垃圾分类|垃圾箱|垃圾代码|内存|缓存/
// 阴阳怪气：字面在夸，意思在骂。这类话按夸处理会把她哄高兴，方向完全反了。
const SARCASTIC = /真是绝了|真厉害啊|你可真行|真行啊|行吧你赢了|呵呵|哦，?厉害|真棒呢|可以啊[，,]\s*又|你真是天才|谢谢啊[，,]\s*又|好家伙|又是这出|服了你了|真有你的/
const REQUEST = /帮我|麻烦你|能不能|可以帮|给我|写个|做个|查一下|看看/

export function analyzeMessage(text) {
  const t = String(text || '')
  return {
    question: QUESTION.test(t) ? 1 : 0,
    complaint: (COMPLAINT.test(t) || (INSULT.test(t) && !TECH_SAFE.test(t)) || SARCASTIC.test(t)) ? 1 : 0,
    rush: RUSH.test(t) ? 1 : 0,
    sarcasm: SARCASTIC.test(t) ? 1 : 0,
    praise: SARCASTIC.test(t) ? 0 : (PRAISE.test(t) ? 1 : 0),
    request: REQUEST.test(t) ? 1 : 0,
    addressed: /你|咱|我们/.test(t) ? 1 : 0,
    length: Array.from(t).length,
  }
}

/** 把最近几轮揉成一个上下文画像 */
export function buildContext(recent = [], current = {}) {
  const last = recent.slice(-6)
  const sum = (k) => last.reduce((s, m) => s + (m.features?.[k] ?? 0), 0)
  const n = Math.max(1, last.length)
  const trend = sum('complaint') / n - sum('praise') / n   // 最近是不是在变糟
  return {
    ...current,
    recentCount: last.length,
    moodTrend: Math.max(-1, Math.min(1, trend)),
    // 连续提问 = 她在确认事情，不是情绪事件
    questionStreak: last.slice(-2).filter(m => m.features?.question).length,
    lastText: last[last.length - 1]?.text?.slice(0, 40) || '',
  }
}
