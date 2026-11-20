// 皮层的向量通道（F5 / 文档 §2.8「稠密向量做语义，BM25 做精确」）。
//
// 设计上刻意做成"可注入 embedFn"：向量模型在海马那侧已经有一份，
// 这里不重复加载模型，只在真正需要时把 embedding 函数传进来。
// 好处是纯逻辑可离线测（假 embedFn），不必等模型。
import fs from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'

// 和 store.js 用同一个目录：测试只要改 CORTEX_DIR 就不会碰到生产数据
const DATA_DIR = process.env.CORTEX_DIR || join(homedir(), '.dsh', 'cortex')
export const VEC_FILE = join(DATA_DIR, 'vectors.json')

export function loadVectors(file = VEC_FILE) {
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'))
    if (!raw || typeof raw !== 'object') return { model: '', dim: 0, vecs: {} }
    return { model: raw.model || '', dim: Number(raw.dim) || 0, vecs: raw.vecs || {} }
  } catch {
    return { model: '', dim: 0, vecs: {} }
  }
}

export function saveVectors(store, file = VEC_FILE) {
  try {
    fs.writeFileSync(file, JSON.stringify(store))
    return true
  } catch {
    return false
  }
}

/** 余弦：不依赖海马模块，避免两边循环引用 */
export function cosine(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || !a.length || a.length !== b.length) return 0
  let dot = 0
  let na = 0
  let nb = 0
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i]
    na += a[i] * a[i]
    nb += b[i] * b[i]
  }
  if (!na || !nb) return 0
  return dot / (Math.sqrt(na) * Math.sqrt(nb))
}

/**
 * 给还没有向量的 cell 补向量。
 * 每次限量，避免启动时一次性算上百条把事件循环占住。
 * 返回 { built, remaining }。
 */
export async function ensureVectors(cells = [], { embedFn, store = null, limit = 16, persist = true } = {}) {
  if (typeof embedFn !== 'function') return { built: 0, remaining: 0, skipped: 'no-embed' }
  const vec = store || loadVectors()
  let built = 0
  const missing = cells.filter((c) => c && c.id && !vec.vecs[c.id] && c.text)
  for (const c of missing.slice(0, limit)) {
    try {
      const v = await embedFn(String(c.text))
      if (Array.isArray(v) && v.length) {
        vec.vecs[c.id] = v
        vec.dim = v.length
        built++
      }
    } catch {
      // 单条失败跳过，不打断整轮
    }
  }
  if (built && persist) saveVectors(vec)
  return { built, remaining: Math.max(0, missing.length - built), total: Object.keys(vec.vecs).length }
}

/** 用向量给 cells 打分，返回 [{ id, score }]（降序） */
export async function searchByVector(query, cells = [], { embedFn, store = null, k = 20, minScore = 0.2 } = {}) {
  if (typeof embedFn !== 'function') return []
  const vec = store || loadVectors()
  let q
  try {
    q = await embedFn(String(query))
  } catch {
    return []
  }
  if (!Array.isArray(q) || !q.length) return []
  const scored = []
  for (const c of cells) {
    const v = vec.vecs[c?.id]
    if (!v) continue
    const s = cosine(q, v)
    if (s >= minScore) scored.push({ id: c.id, score: s })
  }
  scored.sort((a, b) => b.score - a.score)
  return scored.slice(0, k)
}

/**
 * 把向量结果揉进关键词结果。
 * 两边都命中的加权最多；只有向量命中的也保留（这正是"语义比字面宽"的价值），
 * 但压一档，避免纯语义把精确命中顶掉。
 */
export function blend(hits = [], vecScores = [], { weight = 0.35 } = {}) {
  const byId = new Map()
  for (const h of hits) {
    const id = h.id || h.cellId
    if (!id) continue
    byId.set(id, { ...h, score: Number(h.score) || 0, viaVector: false })
  }
  for (const v of vecScores) {
    const cur = byId.get(v.id)
    if (cur) {
      cur.score = cur.score + v.score * weight
      cur.vectorScore = v.score
      cur.viaVector = true
    } else {
      byId.set(v.id, { id: v.id, score: v.score * weight * 0.8, vectorScore: v.score, viaVector: true, only: 'vector' })
    }
  }
  return [...byId.values()].sort((a, b) => b.score - a.score)
}
