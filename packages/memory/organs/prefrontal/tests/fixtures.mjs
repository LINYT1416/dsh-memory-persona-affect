// 固定语料：20 条候选 + 12 个问句。
// 覆盖：冲突对、复述对、跨天、空摘要、坏来源、归档、无来源、长文本。
const NOW = Date.now()
const H = 3600 * 1000
const D = 24 * H

export function makeCands(now = NOW) {
  return [
    {
      episodeId: 'e01', session: 's1', at: now - H, summary: '今天中午吃了火锅，辣得胃疼',
      entities: ['火锅'], place: '火锅店', type: 'episode', state: 'active', confidence: 0.8,
      score: 0.9, why: ['bm25', 'vector'], rawIds: ['r1'], rawCount: 1, source: { kind: '原话', channel: 'ds' },
    },
    {
      episodeId: 'e02', session: 's1', at: now - D, summary: '昨天也吃了火锅，那家一点都不辣',
      entities: ['火锅'], place: '家', type: 'episode', state: 'active', confidence: 0.7,
      score: 0.8, why: ['bm25'], rawIds: ['r2'], rawCount: 1, source: { kind: '原话', channel: 'ds' },
    },
    {
      episodeId: 'e03', session: 's1', at: now - 2 * D, summary: '我说过不爱吃火锅，腻了',
      entities: ['火锅'], type: 'preference', state: 'active', confidence: 0.6,
      score: 0.72, why: ['bm25'], rawIds: ['r3'], rawCount: 1, source: { kind: '原话', channel: 'ds' },
    },
    {
      episodeId: 'e04', session: 's1', at: now - 3 * D, summary: '我很喜欢火锅，一个月能吃五次',
      entities: ['火锅'], type: 'preference', state: 'active', confidence: 0.6,
      score: 0.7, why: ['bm25', 'graph'], rawIds: ['r4'], rawCount: 1, source: { kind: '原话', channel: 'ds' },
    },
    {
      episodeId: 'e05', session: 's2', at: now - 0.9 * H, summary: '今天中午吃火锅，辣得胃疼',
      entities: ['火锅'], place: '火锅店', type: 'episode', state: 'active', confidence: 0.75,
      score: 0.85, why: ['bm25'], rawIds: ['r5'], rawCount: 1, source: { kind: '推断', channel: 'qq' },
    },
    {
      episodeId: 'e06', session: 's2', at: now - 5 * D, summary: '上周去看了电影，坐最后一排',
      entities: ['电影'], place: '影院', type: 'episode', state: 'archived', confidence: 0.5,
      score: 0.6, why: ['bm25'], rawIds: ['r6'], rawCount: 1, source: { kind: '原话', channel: 'ds' },
    },
    {
      episodeId: 'e07', session: 's3', at: now - 6 * H, summary: '', entities: [], type: 'episode',
      state: 'active', confidence: 0.3, score: 0.35, why: ['bm25'], rawIds: [], rawCount: 0, source: { kind: '摘要' },
    },
    {
      episodeId: 'e08', session: 's3', at: now - 7 * H, summary: '她说她想吃日料，还想要那家贵的',
      entities: ['日料'], type: 'preference', state: 'active', confidence: 0.6,
      score: 0.66, why: ['bm25'], rawIds: ['r8'], rawCount: 1,
    },
    {
      episodeId: 'e09', session: 's4', at: now - 8 * D, summary: '那次在威海的海边走了很久，风很大，后来下了点雨，我们躲进一个便利店买了两瓶热的',
      entities: ['威海', '海边'], place: '海边', type: 'episode', state: 'active', confidence: 0.55,
      score: 0.5, why: ['bm25'], rawIds: ['r9'], rawCount: 1, source: { kind: '原话', channel: 'ds' },
    },
    {
      episodeId: 'e10', session: 's4', at: now - 9 * D, summary: 'uid 是 1000003，昵称是鲸鲸',
      entities: ['uid'], type: 'fact', state: 'active', confidence: 0.95,
      score: 0.95, why: ['exact'], rawIds: ['r10'], rawCount: 1, source: { kind: '原话', channel: 'ds' },
    },
    {
      episodeId: 'e11', session: 's5', at: now - 10 * H, summary: '今天加班到十点，饭随便对付了',
      entities: ['加班'], type: 'episode', state: 'active', confidence: 0.7,
      score: 0.62, why: ['bm25'], rawIds: ['r11'], rawCount: 1, source: { kind: '原话', channel: 'ds' },
    },
    {
      episodeId: 'e12', session: 's5', at: now - 11 * H, summary: '我不喜欢下雨天，鞋总是湿',
      entities: ['下雨'], type: 'preference', state: 'active', confidence: 0.6,
      score: 0.4, why: ['bm25'], rawIds: ['r12'], rawCount: 1, source: { kind: '原话', channel: 'ds' },
    },
    {
      episodeId: 'e13', session: 's6', at: now - 12 * H, summary: '地铁上看到一个小孩在背单词',
      entities: ['地铁'], place: '地铁', type: 'episode', state: 'active', confidence: 0.5,
      score: 0.45, why: ['bm25'], rawIds: ['r13'], rawCount: 1, source: { kind: '原话', channel: 'ds' },
    },
    {
      episodeId: 'e14', session: 's6', at: now - 13 * H, summary: '想买那个耳机，太贵了，还没下决心',
      entities: ['耳机'], type: 'episode', state: 'active', confidence: 0.6,
      score: 0.48, why: ['bm25'], rawIds: ['r14'], rawCount: 1, source: { kind: '原话', channel: 'ds' },
    },
    {
      episodeId: 'e15', session: 's7', at: now - 14 * H, summary: '终于把报表赶完了，松了口气',
      entities: ['报表'], type: 'episode', state: 'active', confidence: 0.75,
      score: 0.58, why: ['bm25'], rawIds: ['r15'], rawCount: 1, source: { kind: '原话', channel: 'ds' },
    },
    {
      episodeId: 'e16', session: 's7', at: now - 15 * H, summary: '晚上想去楼下跑两圈，膝盖有点不舒服',
      entities: ['跑步'], place: '楼下', type: 'episode', state: 'active', confidence: 0.5,
      score: 0.42, why: ['bm25'], rawIds: ['r16'], rawCount: 1, source: { kind: '原话', channel: 'ds' },
    },
    {
      episodeId: 'e17', session: 's8', at: now - 16 * H, summary: '不是说要早点睡吗，结果又刷到两点',
      entities: ['睡觉'], type: 'episode', state: 'active', confidence: 0.55,
      score: 0.38, why: ['bm25'], rawIds: ['r17'], rawCount: 1, source: { kind: '原话', channel: 'ds' },
    },
    {
      episodeId: 'e18', session: 's8', at: now - 17 * H, summary: '我妈打电话来问周末回不回去',
      entities: ['妈妈'], type: 'episode', state: 'active', confidence: 0.65,
      score: 0.52, why: ['bm25'], rawIds: ['r18'], rawCount: 1, source: { kind: '原话', channel: 'ds' },
    },
    {
      episodeId: 'e19', session: 's9', at: now - 18 * H, summary: '和你聊到小时候那条狗，叫豆豆',
      entities: ['狗'], type: 'episode', state: 'active', confidence: 0.6,
      score: 0.44, why: ['bm25'], rawIds: ['r19'], rawCount: 1, source: { kind: '原话', channel: 'ds' },
    },
    {
      episodeId: 'e20', session: 's9', at: now - 19 * H, summary: '那天雨太大，伞被吹翻了',
      entities: ['伞'], place: '路上', type: 'episode', state: 'active', confidence: 0.5,
      score: 0.4, why: ['bm25'], rawIds: ['r20'], rawCount: 1, source: { kind: '原话', channel: 'ds' },
    },
  ]
}

export const QUERIES = [
  '我什么时候吃的火锅',
  '我喜欢吃火锅吗',
  '1000003',
  '后来呢',
  '你还记得我说过什么吗',
  '在吗',
  '我不喜欢火锅吗',
  '上周末去了哪',
  '我和她是什么关系',
  '',
  '好',
  '上次那个关于火锅和电影的事情到底是什么时候发生的来着你还记得不',
]

/** 供 golden 用的 50 组：12 个问句 × 轮换候选切片。 */
export function goldenSets(now = NOW) {
  const cands = makeCands(now)
  const out = []
  for (let i = 0; i < 50; i += 1) {
    const q = QUERIES[i % QUERIES.length]
    const start = i % 7
    out.push({ i, query: q, cands: cands.slice(start, start + 6) })
  }
  return out
}
