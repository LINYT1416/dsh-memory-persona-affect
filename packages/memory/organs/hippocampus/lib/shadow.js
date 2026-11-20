// 影子模式：新判定只算不用。
// 目的：先用真实对话攒几天数据，看"三元指纹（参与者/地点/事件类型）"跟现在的
// 时间桶 + 实体重叠判定差多少，再决定要不要真的收紧。不生效，就不会把记忆写碎。

import { appendJsonl, FILES } from './store.js'

const MIN_GAP_MS = 20 * 60 * 1000

/** 简单的参与者判定：谁在说、提到了谁 */
export function participantsOf({ role = 'user', text = '' }) {
  const who = new Set([role === 'user' ? 'owner' : 'me'])
  if (/(他|她|同事|老板|朋友|我妈|我爸|老师|同学)/.test(text)) who.add('third-party')
  return [...who].sort()
}

/** 三元指纹：参与者 + 地点 + event type */
export function triple(ep) {
  return {
    who: participantsOf({ role: ep.role || ep.slots?.who || 'user', text: ep.summary || ep.text || '' }),
    where: ep.place || ep.slots?.where || '',
    what: ep.type || ep.slots?.what || '',
  }
}

function overlap(a = [], b = []) {
  if (!a.length || !b.length) return 0
  const setB = new Set(b)
  return a.filter((x) => setB.has(x)).length / Math.max(a.length, b.length)
}

/**
 * 影子判定：这条新消息如果按三元指纹算，应该"并进已有段"还是"新开一段"。
 * 只有三者都撞上才算 same —— 比现在只看时间和实体更严。
 */
export function shadowJudge(input, candidates = [], { gapMs = MIN_GAP_MS, at = Date.now() } = {}) {
  const me = triple({ ...input, summary: input.text })
  let best = null
  for (const c of candidates) {
    if (Math.abs(at - Number(c.end || c.start || 0)) > gapMs) continue
    const other = triple(c)
    const who = overlap(me.who, other.who)
    const where = me.where && other.where && me.where === other.where ? 1 : 0
    const what = me.what && other.what && me.what === other.what ? 1 : 0
    const score = 0.5 * who + 0.25 * where + 0.25 * what
    if (!best || score > best.score) best = { id: c.id, score, who, where, what }
  }
  // 三者都撞上才算 same：who 1.0 + where 1.0 + what 1.0 = 1.0；缺一项就只有 0.75，不算同一次。
  const kind = best && best.score >= 0.9 && best.who >= 0.99 ? 'same' : 'distinct'
  return { kind, best, me }
}

/** 记录一条影子结论（不改变任何行为） */
export async function logShadow(entry) {
  try {
    await appendJsonl(FILES.shadow, entry)
  } catch { /* 影子日志坏了不该影响主流程 */ }
}
