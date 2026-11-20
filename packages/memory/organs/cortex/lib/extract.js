// 情景 → 语义抽取（F20）：只抽带明确事实词的句子，不做语义推理。
// 规则版零成本可跑；模型版以后替换 extractWithModel（后门 E4）。
import { clean, isNoise, sentences } from './util.js'
import { makeCell } from './schema.js'
import { zoneOf } from './zones.js'
import { featuresOf } from './features.js'
import { layerOf } from './layers.js'
import { select } from './sparsity.js'

const THREAT = /(裁员|裁人|开除|辞退|失业|分手|吵架|生病|医院|住院|钱不够|房贷|逾期|崩溃|懵|慌|出汗|失眠|被骂|挨骂|失败|挂了|离职|压力大|逼)/

export function isThreatText(text) {
  return THREAT.test(String(text || ''))
}

/** 抽取规则版本：改了规则就 +1，启动时会把旧 episode 重抽一遍。 */
export const EXTRACT_VERSION = 12

/**
 * 只保留"她说的"那部分。
 * 合并后的 episode 长这样：她说：…… \n 我说：……
 * 如果不切，我的回复里满篇"我"，会被规则当成她的事实抽出来 —— 这是最直接的假事实来源。
 */
export function hersOnly(text) {
  const t = String(text || '')
  const cut = t.indexOf('我说：')
  const head = cut >= 0 ? t.slice(0, cut) : t
  const start = head.indexOf('她说：')
  const body = start >= 0 ? head.slice(start + 3) : head
  return body.trim()
}

/** 不该抽的句子：问句、假设、引用别人、否定假设。宁可漏，不可错。 */
export function isUnsafeSentence(text) {
  const s = String(text || '')
  if (/[？?]/.test(s)) return true
  if (/(如果|假如|要是|若是|万一|假设)/.test(s)) return true
  if (/(他说|她说|他说过|有人说|听说|据说)/.test(s)) return true
  if (/(不代表|并不意味着|并不是说|未必|不一定)/.test(s)) return true
  if (/@/.test(s)) return true
  // 疑问词（句末问号在分句时已经被去掉，只能靠词判）
  if (/(吗|呢|嘛)\s*$/.test(s)) return true
  if (/(几点|哪|什么时候|怎么办|为什么|什么|哪里|哪儿|谁|是不是|要不要|能不能|可不可以)/.test(s)) return true
  return false
}

const RULES = [
  {
    name: 'account',
    test: /(?:uid|账号|号码|手机号|qq|微信)\s*(?:还是|是|为|[:：=])?\s*([0-9a-z_]{4,})/i,
    build: (m, s) => ({ kind: 'fact', subject: '主人', predicate: '账号', object: m[1], text: s }),
  },
  {
    // “B 站 uid 1000003”“bilibili 1000003”这类，中间常有空格
    name: 'account2',
    test: /(?:b\s*站|bilibili)[^\d]{0,12}(\d{4,})/i,
    build: (m, s) => ({ kind: 'fact', subject: '主人', predicate: '账号', object: m[1], text: s }),
  },
  {
    // 窗口/范围的职责：“这个窗口只负责…”“职责限定为…”
    name: 'duty',
    test: /(?:这个窗口|这个对话|这边|以后)[^，。！？]{0,12}(?:只负责|只做|只管|负责|限定为)\s*([^，。！？]{2,30})/,
    build: (m, s) => ({ kind: 'fact', subject: '主人', predicate: '负责', object: m[1], text: s }),
  },
  {
    name: 'duty2',
    test: /职责\s*(?:是|为|限定为)\s*([^，。！？]{2,30})/,
    build: (m, s) => ({ kind: 'fact', subject: '主人', predicate: '负责', object: m[1], text: s }),
  },
  {
    // 关系型事实：她给我起的称呼。以前这条规则不存在，所以"以后叫你鱼鱼"根本没落过库。
    // 必须排在 name 前面——"以后叫我鱼鱼"里的"叫我"会被 name 规则误判成她自己的名字。
    name: 'nickname-of-me',
    test: /(?:以后|往后|就|都)?\s*(?:叫你|管你叫|喊你|称呼你为)\s*([\u4e00-\u9fa5a-z0-9_]{1,10})/i,
    build: (m, s) => ({ kind: 'fact', subject: 'ta', predicate: '称呼', object: m[1], text: s }),
  },
  {
    name: 'name',
    test: /(?:我叫|名字叫|昵称叫|叫我)\s*([\u4e00-\u9fa5a-z0-9_]{1,20})/i,
    build: (m, s) => ({ kind: 'fact', subject: '主人', predicate: '名字', object: m[1], text: s }),
  },
  {
    name: 'like',
    test: /我(?:很|最|超)?(?:喜欢|爱|稀罕)\s*([^，。！？\s]{1,20})/,
    build: (m, s) => ({ kind: 'preference', subject: '主人', predicate: '喜欢', object: m[1], text: s }),
  },
  {
    name: 'dislike',
    test: /我(?:很|最|超)?(?:讨厌|不喜欢|受不了|烦)\s*([^，。！？\s]{1,20})/,
    build: (m, s) => ({ kind: 'preference', subject: '主人', predicate: '讨厌', object: m[1], text: s }),
  },
  {
    name: 'identity',
    test: /我是\s*([^，。！？]{2,30})/,
    build: (m, s) => ({ kind: 'trait', subject: '主人', predicate: '是', object: m[1], text: s }),
  },
  {
    // "我住在威海"这种最常见的自我介绍，以前没有任何一条规则匹配得到：
    // action 那条要求"我在/我最近在"，接不住"我住在"。结果居所类事实永远抽不出来。
    name: 'residence',
    test: /我(?:住在|家在|住在)\s*([^，。！？\s]{2,12})/,
    build: (m, s) => ({ kind: 'fact', subject: '主人', predicate: '住在', object: m[1], text: s }),
  },
  {
    // "我在一家机器人公司上班"：地点/单位要留下来，不然"在哪儿工作"永远答不出。
    name: 'workplace',
    test: /我(?:在|最近在)\s*([^，。！？\s]{2,20})\s*(?:上班|工作|实习)/,
    build: (m, s) => ({ kind: 'fact', subject: '主人', predicate: '在…上班', object: m[1], text: s }),
  },
  {
    name: 'action',
    test: /我(?:正在|最近在|还在|在)\s*([^，。！？]{2,30})/,
    build: (m, s) => ({ kind: 'fact', subject: '主人', predicate: '正在做', object: m[1], text: s }),
  },
  {
    name: 'plan2',
    // 实测漏过「明天想去海边走走」：原规则要求动作动词在词表里，
    // 而"想去/要去/打算去"这种先用情态再跟动词的说法全漏了。补上 去/玩/逛/吃/看/走。
    test: /(?:明天|明早|今天|今晚|早上|上午|下午|晚上|待会|周末)[^，。！？]{0,20}(?:起床|买|上班|回家|吃饭|睡|赶|做|见|去|玩|逛|看|走|吃)/,
    build: (m, s) => ({ kind: 'fact', subject: '主人', predicate: '计划', object: s.slice(0, 40), text: s }),
  },
  {
    name: 'event',
    test: THREAT,
    build: (m, s) => ({ kind: 'event', subject: '主人', predicate: '经历', object: s.slice(0, 40), text: s }),
  },
  {
    name: 'hope',
    test: /我(?:希望|想要|想要的是)\s*([^，。！？]{2,40})/,
    build: (m, s) => ({ kind: 'fact', subject: '主人', predicate: '希望', object: m[1], text: s }),
  },
  {
    name: 'care',
    test: /我(?:最)?在意(?:的是)?\s*([^，。！？]{2,40})/,
    build: (m, s) => ({ kind: 'preference', subject: '主人', predicate: '在意', object: m[1], text: s }),
  },
  {
    name: 'opinion',
    test: /我(?:觉得|感觉)\s*([^，。！？]{2,40})/,
    build: (m, s) => ({ kind: 'preference', subject: '主人', predicate: '觉得', object: m[1], text: s }),
  },
  {
    name: 'bottomline',
    test: /我的底线[：:]\s*([^。！？]{2,60})/,
    build: (m, s) => ({ kind: 'fact', subject: '主人', predicate: '底线', object: m[1], text: s }),
  },
  {
    name: 'hate2',
    test: /我(?:嫌|烦)\s*([^，。！？]{2,30})/,
    build: (m, s) => ({ kind: 'preference', subject: '主人', predicate: '讨厌', object: m[1], text: s }),
  },
  {
    name: 'relation',
    test: /(我爸|我妈|我哥|我姐|我弟|我妹|我对象|男朋友|女朋友|我朋友|我室友|我同事)\s*(?:叫|是)?\s*([^，。！？]{1,20})?/,
    build: (m, s) => ({ kind: 'relation', subject: m[1], predicate: '关系', object: m[2] || '', text: s }),
  },
  {
    name: 'plan',
    test: /我(?:打算|准备|要|想)\s*([^，。！？]{2,30})/,
    build: (m, s) => ({ kind: 'fact', subject: '主人', predicate: '计划', object: m[1], text: s }),
  },
  {
    // 习惯类：一般/通常/总是/经常/习惯。"我一般都十点起"这种以前一条都抽不到。
    name: 'habit',
    test: /我(?:一般|通常|总是|经常|习惯|向来)\s*([^，。！？]{2,30})/,
    build: (m, s) => ({ kind: 'preference', subject: '主人', predicate: '习惯', object: m[1], text: s }),
  },
  {
    // 能力/状态类：我会/我能/我做不到/我不会。只收短句，避免吞掉整段。
    name: 'ability',
    test: /我(?:会|能|可以|不会|不能|做不到)\s*([^，。！？]{2,20})/,
    build: (m, s) => ({ kind: 'trait', subject: '主人', predicate: '能', object: m[1], text: s }),
  },
]

/** 地点不再单独建档，只当其他 cell 的标签（否则会碎成“地点：楼下”）。 */
function placeOf(sentence) {
  const m = /(?:在|去|到)\s*([^，。！？\s]{2,12})(?:吃|玩|上班|住|逛|买)/.exec(String(sentence || ''))
  return m ? m[1] : ''
}

/** 同一句话被 event 抽到时，只留 event；没有 event 就各留各的（一句话可含多个事实）。 */
function dedupeByText(list) {
  const hasEvent = list.some((c) => c.kind === 'event')
  const filtered = hasEvent
    // 事件已经覆盖整句时，“正在做：电话里没敢哭”和关系碎片都不该单独占位
    ? list.filter((c) => c.kind !== 'relation' && c.predicate !== '正在做')
    : list
  const byText = new Map()
  for (const c of filtered) {
    if (!byText.has(c.text)) byText.set(c.text, [])
    byText.get(c.text).push(c)
  }
  const out = []
  for (const group of byText.values()) {
    const ev = group.find((c) => c.kind === 'event')
    if (ev) out.push(ev)
    else out.push(...group)
  }
  return out
}

/** 从一段文本抽候选。 */
export function extract(text, { episodeId = '', at = Date.now(), speaker = 'user' } = {}) {
  const out = []
  const seen = new Set()
  for (const raw of sentences(hersOnly(text))) {
    if (isUnsafeSentence(raw)) continue   // 先判原始句子：问号/假设词在 clean 之后会被抹掉
    const s = clean(raw, 200)
    if (!s || isNoise(s)) continue
    // 只用于匹配：海马体摘要会把“我”写成“ta”，还原后规则才命中；cell.text 仍保留原句
    const n = s.replace(/\bta\b\s*/gi, '我')
    for (const rule of RULES) {
      const m = rule.test.exec(n)
      if (!m) continue
      const built = rule.build(m, s)
      if (!built.object) continue
      const key = `${built.kind}|${built.subject}|${built.predicate}|${built.object}`
      if (seen.has(key)) continue
      seen.add(key)
      const source = speaker === 'user' ? 'stated' : 'inferred'
      const place = placeOf(s)
      out.push({
        ...built,
        source,
        confidence: source === 'stated' ? 0.9 : 0.6,
        zone: zoneOf(built.kind),
        layer: source === 'stated' ? 'semantic' : 'inference',
        tags: [...(built.tags || []), ...(place ? [`place:${place}`] : [])],
        featureIds: featuresOf(built.text),
        supportIds: episodeId ? [episodeId] : [],
        anchors: episodeId ? [episodeId] : [],
        order: at,
        rule: rule.name,
      })
    }
  }
  return dedupeByText(out)
}

/** 从海马体 episode 快照抽（入站 extract 的默认实现）。 */
export function extractEpisode(ep, opts = {}) {
  const pieces = [ep?.summary, ep?.text, ...(ep?.rawTexts || [])].filter(Boolean)
  if (!pieces.length) return []
  const speaker = ep?.speaker || (ep?.role === 'assistant' ? 'assistant' : 'user')
  return extract(hersOnly(pieces.join('。')), { episodeId: ep?.id || '', at: Number(ep?.start || Date.now()), speaker, ...opts })
}

/** 结构化输出（F43）：地点、实体、类型，给海马体的图与坐标用。 */
export function structureOf(text) {
  const places = []
  const entities = []
  for (const s of sentences(text)) {
    const p = /(?:在|去|到)\s*([^，。！？\s]{2,12})/.exec(s)
    if (p) places.push(p[1])
    const q = /(我爸|我妈|我哥|我姐|我弟|我妹|我朋友|我室友|我同事|男朋友|女朋友)/.exec(s)
    if (q) entities.push(q[1])
  }
  return { places: [...new Set(places)], entities: [...new Set(entities)] }
}

/** 转 cell（写库前调用）。没带 text 时用主谓宾拼一句，避免空条目。 */
export function toCell(candidate) {
  const text = candidate.text
    || [candidate.subject, candidate.predicate, candidate.object].filter(Boolean).join('')
  return makeCell({
    kind: candidate.kind,
    zone: candidate.zone || zoneOf(candidate.kind),
    layer: candidate.layer || layerOf(candidate.source),
    subject: candidate.subject,
    predicate: candidate.predicate,
    object: candidate.object,
    text: clean(text, 300),
    tags: [...new Set([...(candidate.tags || []), candidate.kind, candidate.rule].filter(Boolean))],
    featureIds: select((candidate.featureIds || []).map((id) => [id, 1]), { topK: 16 }).map(([id]) => id),
    supportIds: candidate.supportIds || [],
    anchors: candidate.anchors || [],
    confidence: candidate.confidence ?? 0.5,
    source: candidate.source || 'inferred',
    state: candidate.state || 'hypothesis',
    evidenceCount: Math.max(1, candidate.evidenceCount || (candidate.supportIds || []).length || 1),
    extractVersion: candidate.extractVersion || EXTRACT_VERSION,
    firstSeen: candidate.order || Date.now(),
    lastSeen: candidate.order || Date.now(),
    order: candidate.order || 0,
  })
}
