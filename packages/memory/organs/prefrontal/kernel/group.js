// #P0-5 组块化：同主题多条合成一组「指针」。
// 只并指针，不生成句子（C1）；真压缩走 F13 皮层。
export function mergePointers(items = [], { maxGroups = 4 } = {}) {
  const groups = new Map()
  for (const it of items) {
    const key = groupKey(it)
    const g = groups.get(key) || { key, ids: [], chars: 0, items: [] }
    g.ids.push(it.episodeId || it.id)
    g.chars += String(it.summary || '').length
    g.items.push(it)
    groups.set(key, g)
  }
  return [...groups.values()]
    .sort((a, b) => b.ids.length - a.ids.length)
    .slice(0, maxGroups)
    .map((g) => ({
      key: g.key,
      ids: g.ids,
      count: g.ids.length,
      // 只借用第一条的摘要当"这条组的标签"，不新写文本
      label: String(g.items[0]?.summary || '').slice(0, 40),
      packed: g.ids.length > 1,
    }))
}

function groupKey(it) {
  if (it.type) return `t:${it.type}`
  if (it.place) return `p:${it.place}`
  const e = (it.entities || [])[0]
  if (e) return `e:${e}`
  return 'other'
}

/** 组块之后字符是否真的变小了（验收 #21 用得上）。 */
export function packingGain(items = []) {
  const before = items.length
  const charsBefore = items.reduce((n, x) => n + String(x.summary || '').length, 0)
  const groups = mergePointers(items)
  const charsAfter = groups.reduce((n, g) => n + g.label.length, 0)
  return { before, after: groups.length, charsBefore, charsAfter, saved: charsBefore - charsAfter }
}
