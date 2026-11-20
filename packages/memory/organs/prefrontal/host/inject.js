// #P0-11 注入预算与组装 / #P0-5 组块化落地 / #P3-10 漂移拉回
// 规矩（R14）：预算紧时先砍背景档内容，绝不砍置信与来源标记——那几个字符不值当。
import { trimForBudget } from '../kernel/budget.js'
import { mergePointers } from '../kernel/group.js'

/**
 * 组装注入块。只有前额叶能拼这一块（别的器官给素材，不给成品）。
 * 热区先过一遍组块化：同主题的多条并成一组指针，不生成新句子（C1）。
 * 返回 {text, parts, chars, truncated, essentialKept, groups}
 */
export function compose(ctx = {}) {
  const parts = []
  const task = ctx.task
  if (task?.goal) {
    parts.push({ kind: 'task', essential: true, text: `【手上的活】${task.goal}${task.rules?.length ? `（不许：${task.rules.join('、')}）` : ''}` })
  }
  if (ctx.constraint?.note) {
    parts.push({ kind: 'constraint', essential: true, text: `【当心】${ctx.constraint.note}` })
  }
  if (ctx.fok === 'suppressed') {
    parts.push({ kind: 'fok', essential: true, text: '【提醒】刚才是我压掉的，不是没有' })
  }

  const hot = (ctx.hot || []).slice(0, 6)
  const groups = mergePointers(hot, { maxGroups: 4 })
  for (const g of groups) {
    const src = g.items?.[0]?.source?.kind ? `·${g.items[0].source.kind}` : ''
    const conf = Number.isFinite(g.items?.[0]?.confidence) ? `·可信${g.items[0].confidence}` : ''
    parts.push({
      kind: 'item',
      essential: false,
      tier: g.items?.[0]?.tier,
      text: `- ${String(g.label).slice(0, 50)}${g.packed ? `（同题 ${g.count} 条）` : ''}${src}${conf}`,
    })
  }

  if (ctx.adopted?.use) parts.push({ kind: 'topic', essential: false, text: `【话题】还在说：${String(ctx.adopted.value).slice(0, 20)}` })

  const { kept, chars } = trimForBudget(parts, { maxChars: ctx.maxChars ?? 900 })
  const text = kept.map((p) => p.text).join('\n')
  return {
    text,
    parts: kept,
    chars,
    truncated: kept.length < parts.length,
    essentialKept: kept.filter((p) => p.essential).length,
    groups: groups.length,
  }
}

/**
 * 漂移拉回（#P3-10）：连续 N 轮跑题，就把目标提回注入。
 * 只在"有未完成任务"时拉——没有任务就没有"跑题"这回事。
 * 注意：off 必须在这里累加，否则这个功能永远不会触发（上一版就是死的）。
 */
export function drift(state = {}, { task, text = null, now = Date.now(), turns = 2 } = {}) {
  const next = { ...state, off: Number(state.off) || 0, lastAt: now }
  if (!task) return { state: { ...next, off: 0 }, pull: false, line: null }

  if (text !== null && text !== undefined) {
    const moved = switched(next.lastText, text)
    next.off = moved ? next.off + 1 : 0
    next.lastText = text
  }

  const hit = next.off >= turns
  if (hit) next.off = 0
  return {
    state: next,
    pull: hit,
    line: hit ? `【拉回】你还在做：${task.goal}` : null,
  }
}

/** 话题是否变了：字面重叠低于阈值算变。 */
export function switched(prevText, nextText, threshold = 0.15) {
  if (!prevText || !nextText) return false
  const a = new Set(String(prevText).split(/[\s，。！？]+/).filter((x) => x.length >= 2))
  const b = new Set(String(nextText).split(/[\s，。！？]+/).filter((x) => x.length >= 2))
  if (!a.size || !b.size) return false
  let hit = 0
  for (const x of a) if (b.has(x)) hit += 1
  return hit / Math.min(a.size, b.size) < threshold
}
