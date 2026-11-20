// #P1-4 检索目标：把"我要找的是什么"显式化，交给海马当调制信号。
// 海马若不认 target（现在的实现就不认），本条退化成"给自己看的备注"，不报错。
import { tokens, uniq } from './text.js'

const SLOT_OF = {
  fact: ['是什么', '数值'],
  episode: ['发生了什么', '在哪', '谁'],
  relation: ['谁和谁', '什么关系'],
  time: ['什么时候', '先后'],
  preference: ['喜欢什么', '态度'],
  meta: ['我说过吗', '有没有记'],
  sequence: ['后来', '之前'],
  chat: [],
  empty: [],
}

export function buildTarget(q, intent, filters = {}, ctx = {}) {
  const slots = SLOT_OF[intent] || ['发生了什么']
  // 扩写口：ctx.expanded 是皮层返回的"原句 + 同义/上位词"整串（P1-5 的口子）。
  // 只并进 keys，不改 query——改写 query 会让海马体以为换了问句。
  const base = tokens(q)
  const extra = ctx.expanded ? tokens(ctx.expanded) : []
  const keys = uniq([...base, ...extra]).slice(0, 10)
  const parts = []
  if (ctx.task) parts.push(`当前任务：${ctx.task}`)
  parts.push(`要找：${q}`)
  if (filters.timeLabel) parts.push(`时间：${filters.timeLabel}`)
  if (slots.length) parts.push(`要回答：${slots.join('、')}`)

  return {
    text: parts.join('；').slice(0, 200),
    slots,
    keys,
    expanded: ctx.expanded || null,
    // 给海马的可选入参（F17）。它不认就当没有，绝不因此报错。
    hint: { target: parts[0] ? String(q).slice(0, 80) : '', exclude: [], boost: keys.slice(0, 3) },
  }
}

/** #P1-4 对外的名字：出检索目标。 */
export function build(q, intent, filters = {}, ctx = {}) {
  return buildTarget(q, intent, filters, ctx)
}

/** 目标与某条候选的重叠，用来判断"这条是不是我要找的那类"。 */
export function targetFit(cand, target) {
  if (!target?.keys?.length) return 0
  const text = `${cand.summary || ''} ${(cand.entities || []).join(' ')}`
  let hit = 0
  for (const k of target.keys) if (text.includes(k)) hit += 1
  return hit / target.keys.length
}
