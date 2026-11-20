// 图式结构与语义边（F22、F43、R4）：实体-关系-实体，带类型。
// 图式只加边和标签，不改 cell 的原始特征。
import { sha16 } from './util.js'

export function entityNode(name) {
  return `e_${sha16(String(name).trim().toLowerCase())}`
}

export function cellNode(id) {
  return String(id).startsWith('c_') ? String(id) : `c_${id}`
}

/** 把一条 cell 挂进图：实体节点 + 与 cell 的关系边。 */
export function attach(store, cell) {
  const node = cellNode(cell.id)
  if (cell.subject) store.addEdge(entityNode(cell.subject), node, 'subject', 1)
  if (cell.object) store.addEdge(node, entityNode(cell.object), cell.kind === 'relation' ? 'relation' : 'object', 1)
  for (const tag of cell.tags || []) store.addEdge(node, entityNode(tag), 'tag', 0.5)
  return node
}

/** 共现边（一起出现）。 */
export function cooccur(store, ids, kind = 'cooccur') {
  for (let i = 0; i < ids.length; i++) {
    for (let j = i + 1; j < ids.length; j++) store.addEdge(ids[i], ids[j], kind, 1)
  }
}

/** 时间边：先 → 后。weight 由 STDP 给（F12）。 */
export function temporal(store, earlier, later, w = 1) {
  if (!earlier || !later) return null
  return store.addEdge(cellNode(earlier), cellNode(later), 'temporal', w)
}

/** 相似边：复述 vs 本体。 */
export function similar(store, a, b, w = 1) {
  return store.addEdge(cellNode(a), cellNode(b), 'similar', w)
}

/** 关系输出（给海马体 L2-3/L2-8/L2-6）。 */
export function edgesOf(store, id) {
  return store.edgesOf(id).map((e) => ({ kind: e.kind, from: e.from, to: e.to, w: e.w }))
}
