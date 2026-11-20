// S03 自传体叙事：把散落的事件收成一条"从什么时候开始、走到哪了"的线。
// 只做整理，不编情节：事件都是记忆里已有的，重复的去掉，时间排好。

/**
 * @param {Array<{at?:number, text?:string, summary?:string}>} episodes
 * @param {number} now
 */
export function biography(episodes = [], now = Date.now()) {
  const list = Array.isArray(episodes) ? episodes : []
  const seen = new Set()
  const items = []

  for (const e of list) {
    if (!e || typeof e !== 'object') continue
    const at = Number(e.at ?? e.ts ?? e.time)
    const text = String(e.summary || e.text || '').trim()
    if (!Number.isFinite(at) || !text) continue
    // 记忆摘要有重复：按"去掉标点后的前 20 字"去重
    const key = text.replace(/[\s，。、！？,.!?]/g, '').slice(0, 20)
    if (seen.has(key)) continue
    seen.add(key)
    items.push({ at, text })
  }

  if (items.length < 2) return { line: null, spanDays: 0, count: items.length, milestones: [], because: 'too-few' }

  items.sort((a, b) => a.at - b.at)
  const first = items[0]
  const last = items[items.length - 1]
  const spanDays = Math.max(0, Math.round((last.at - first.at) / (24 * 60 * 60 * 1000)))

  // 只取三个节点，避免把事件列表塞进注入
  const milestones = [items[0], items[Math.floor(items.length / 2)], last]
    .filter((x, i, arr) => arr.findIndex((y) => y.text === x.text) === i)
    .map((x) => x.text.slice(0, 24))

  const line = spanDays >= 1
    ? `从「${milestones[0]}」到现在，已经 ${spanDays} 天了`
    : `最近这几件事连起来：${milestones.join('、')}`

  return { line, spanDays, count: items.length, milestones, because: 'built' }
}
