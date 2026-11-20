// #P1-6 多路选择与权重：决定走哪几路、各占多少。
// 第四路（皮层语义）留空位：拿不到就是 absent，不拿哈希冒充。
export const ROUTES = ['bm25', 'vector', 'graph', 'exact', 'semantic']

const BASE = {
  fact: { bm25: 0.2, vector: 0.05, graph: 0.05, exact: 0.7 },
  episode: { bm25: 0.5, vector: 0.3, graph: 0.2, exact: 0 },
  relation: { bm25: 0.4, vector: 0.3, graph: 0.3, exact: 0 },
  time: { bm25: 0.55, vector: 0.25, graph: 0.2, exact: 0 },
  preference: { bm25: 0.5, vector: 0.3, graph: 0.2, exact: 0 },
  meta: { bm25: 0.6, vector: 0.3, graph: 0.1, exact: 0 },
  sequence: { bm25: 0.3, vector: 0.1, graph: 0.1, exact: 0 },
  chat: { bm25: 0.8, vector: 0.2, graph: 0, exact: 0 },
  empty: { bm25: 1, vector: 0, graph: 0, exact: 0 },
}

/**
 * 权重表。capabilities 决定"这一路在不在"：
 * 缺向量（没有模型）就别给它权重，否则等于把预算喂给一个空路。
 */
export function weights(intent, capabilities = {}) {
  const base = { ...(BASE[intent] || BASE.episode) }
  if (!capabilities.vector) delete base.vector
  if (!capabilities.graph) delete base.graph
  if (!capabilities.semantic) delete base.semantic
  const total = Object.values(base).reduce((a, b) => a + b, 0) || 1
  const out = {}
  for (const [k, v] of Object.entries(base)) out[k] = Number((v / total).toFixed(4))
  return out
}

/** 实际命中了哪几路（喂给置信度第 2 个信号）。 */
export function routesHit(verdictWhy = []) {
  const hit = new Set()
  for (const w of verdictWhy) {
    const s = String(w)
    if (s.startsWith('bm25')) hit.add('bm25')
    else if (s.includes('vector')) hit.add('vector')
    else if (s.includes('graph')) hit.add('graph')
    else if (s.includes('exact')) hit.add('exact')
    else if (s.includes('semantic')) hit.add('semantic')
  }
  return [...hit]
}

/**
 * 按权重算"这一条被几路托着"。
 * 权重不是摆设：多路命中里，权重高的那几路更能撑住置信度。
 */
export function weightedScore(hitRoutes = [], table = {}) {
  const total = Object.values(table).reduce((n, x) => n + (Number(x) || 0), 0) || 1
  let got = 0
  for (const r of hitRoutes) got += Number(table[r]) || 0
  return Math.max(0, Math.min(1, got / total))
}
