// 检索控制：#P1-1 意图 / #P1-2 模式 / #P1-3 过滤 / #P1-10 序列路由
// 纯函数：不读盘、不看时钟（now 从 ctx 进）。
import { intentOf, uidLike, timeRange, seqAsk, tokens } from './text.js'
import { buildTarget } from './target.js'

const MODE_OF = {
  fact: 'separate',
  time: 'complete',
  relation: 'complete',
  preference: 'complete',
  episode: 'complete',
  meta: 'complete',
  sequence: 'sequence',
  chat: 'skip',
  empty: 'skip',
}

export function intent(q) {
  return intentOf(q)
}

export function mode(intentName, q, opts = {}) {
  if (opts.mode && opts.mode !== 'auto') return opts.mode
  if (uidLike(q)) return 'separate'
  return MODE_OF[intentName] || 'complete'
}

export function isSequence(q) {
  return seqAsk(q)
}

/**
 * 只出"软过滤"，而且**只放海马体认识的字段**（since/until/type）。
 * 两个坑：
 * 1. 把 session 塞进来 = 只在本会话里找 = 记性只剩当前对话（跨会话记忆全看不见）
 * 2. 把 entities/timeLabel 塞进来 = 海马体不认，白传；万一它按数组严格匹配就全空
 * 所以：entities 只进 target.keys（当目标信号用），session 只在 caller 显式要求时才过滤。
 */
export function filters(q, ctx = {}) {
  const out = {}
  const tr = timeRange(q, ctx.now || Date.now())
  if (tr?.since) out.since = tr.since
  if (tr?.until) out.until = tr.until
  if (ctx.type) out.type = ctx.type
  if (ctx.onlySession && ctx.session) out.session = ctx.session
  return out
}

/**
 * 计划：给海马的 mode/filters，给自己留 target，给下游留 exclude。
 * why 每一条都要能读——没有 why 的计划不许发（C5）。
 */
export function plan(q, ctx = {}) {
  const query = String(q ?? '')
  const it = intent(query)
  const m = mode(it, query, ctx)
  const f = filters(query, ctx)
  const target = buildTarget(query, it, f, ctx)
  const expands = ctx.expand === false ? [] : [] // 扩写在 expand.js，由宿主决定是否启用
  const tr = timeRange(query, ctx.now || Date.now())
  const why = [
    `intent:${it}`,
    `mode:${m}`,
    tr ? `time:${tr.label}` : null,
    f.type ? `type:${f.type}` : null,
    target.slots.length ? `target:${target.slots.join('|')}` : null,
  ].filter(Boolean)

  return {
    query,
    intent: it,
    mode: m,
    filters: f,
    target,
    // 扩写串（皮层给的"原句 + 同义/上位词"）。retrieve 用它跑第二轮召回。
    expanded: ctx.expanded || null,
    expands,
    exclude: [],
    budget: ctx.budget || null,
    why,
  }
}

/** 精确问法：海马走 separate 时用（不走向量）。 */
export function exactQuery(q) {
  const s = String(q ?? '')
  const quoted = s.match(/[「『"“]([^」』"”]+)[」』"”]/)
  if (quoted) return quoted[1]
  const num = s.match(/\d{4,}/)
  if (num) return num[0]
  return s.trim()
}

export function keywordsOf(q) {
  return tokens(q).slice(0, 8)
}
