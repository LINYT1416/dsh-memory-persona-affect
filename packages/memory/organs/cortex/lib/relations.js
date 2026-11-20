// 语义边/层级/地点输出（F43）：给海马体的图与坐标补语义。
import { cellNode } from './schema-graph.js'

export function edges(store, id) {
  return store.edgesOf(id).map((e) => ({ kind: e.kind, from: e.from, to: e.to, w: e.w }))
}

/** 层级：主体 → 谓词 → 客体列表（给 L2-8 的主题路径）。 */
export function hierarchy(cells) {
  const map = new Map()
  for (const c of cells) {
    if (c.retracted) continue
    const key = `${c.subject}|${c.predicate}`
    if (!map.has(key)) map.set(key, [])
    if (c.object && !map.get(key).includes(c.object)) map.get(key).push(c.object)
  }
  const out = []
  for (const [key, objects] of map) {
    const [subject, predicate] = key.split('|')
    out.push({ subject, predicate, objects })
  }
  return out
}

/** 地点：从 place 型 cell + `place:` 标签汇总（给 L2-6）。 */
export function places(cells) {
  const out = new Set()
  for (const c of cells) {
    if (c.retracted) continue
    if (c.kind === 'place' && c.object) out.add(c.object)
    for (const tag of c.tags || []) {
      if (typeof tag === 'string' && tag.startsWith('place:')) out.add(tag.slice(6))
    }
  }
  return [...out].filter(Boolean).slice(0, 50)
}

export function nodeOf(id) {
  return cellNode(id)
}
