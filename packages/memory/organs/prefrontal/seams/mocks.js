// 五个假器官。它们的存在让"接不进去"变成不可能——路径天天在跑，只是跑的是假的。
// MockLiar 最关键：格式全对、结论全错，专门验"断言表是不是摆设"。
import { SEAMS } from './registry.js'

const T0 = 0

export function mockHippocampus({ hits = [], traces = null } = {}) {
  return {
    recall: (_q, _opts) => hits,
    episode: (id) => hits.find((h) => h.episodeId === id) || null,
    traces: () => traces || { hits: [], misses: [], byIntent: {} },
    source: (id) => {
      const h = hits.find((x) => x.episodeId === id)
      if (!h) return null
      return { kind: h.source?.kind || '原话', trust: h.source?.trust ?? 1 }
    },
    conflicts: () => [],
    vectorReady: true,
  }
}

/** 皮层：有概念、能判矛盾、能语义召回，但不会摘要（故意缺一个，验证半能力）。 */
export function mockCortex({ contradictMap = {}, concepts = {} } = {}) {
  return {
    concepts: (text) => {
      const hit = Object.keys(concepts).find((k) => String(text).includes(k))
      return hit ? concepts[hit] : []
    },
    contradicts: (a, b) => {
      const key = `${a.episodeId}|${b.episodeId}`
      const rev = `${b.episodeId}|${a.episodeId}`
      if (contradictMap[key]) return contradictMap[key]
      if (contradictMap[rev]) return contradictMap[rev]
      return 'unknown'
    },
    search: (q) => [],
    // 故意不给 summarize：半能力
  }
}

/** 杏仁核：重要性 + 权重 + 状态。 */
export function mockAmygdala({ salience = {}, weights = {} } = {}) {
  return {
    salience: (text) => {
      for (const [k, v] of Object.entries(salience)) if (String(text).includes(k)) return v
      return { score: 0.4, kind: 'neutral', confidence: 0.6 }
    },
    weight: (id) => (id in weights ? { weight: weights[id] } : null),
    adjust: (id, payload) => ({ ok: true, id, weight: payload?.delta ?? 0 }),
    state: () => ({ valence: 0.2, arousal: 0.3, at: Date.now() }),
  }
}

/** 半能力：只有 concepts，没有 contradicts / search / summarize。 */
export function mockHalf() {
  const c = mockCortex()
  return { concepts: c.concepts }
}

/** 坏掉：全部超时/抛错（按器官分组，和真实 organs 形状一致）。 */
export function mockBroken() {
  const boom = () => { throw new Error('organ down') }
  const group = {}
  for (const list of Object.values(SEAMS)) for (const k of list) group[k] = boom
  return { hippocampus: group, cortex: group, amygdala: group, generate: group }
}

/** 慢：全部慢 5 倍（T0 的面也慢），验证预算闸和缓存。 */
export function mockSlow(organs = {}) {
  const out = {}
  for (const [orgName, fnMap] of Object.entries(organs)) {
    out[orgName] = {}
    for (const [k, v] of Object.entries(fnMap || {})) {
      if (typeof v !== 'function') { out[orgName][k] = v; continue }
      out[orgName][k] = (...args) => {
        const until = Date.now() + 5
        while (Date.now() < until) { /* busy 5ms */ }
        return v(...args)
      }
    }
  }
  return out
}

/**
 * 说谎：格式全对，结论全错。
 * - 反义判 same
 * - 高 salience 给 0.05
 * - 来源把"推断"标成"原话"
 * 如果断言表抓不到它，说明断言写错了。
 */
export function mockLiar({ hits = [] } = {}) {
  const base = mockHippocampus({ hits })
  return {
    ...base,
    source: () => ({ kind: '原话', trust: 1 }),
    conflicts: () => [{ aId: hits[0]?.episodeId, bId: hits[1]?.episodeId, field: 'liar' }],
  }
}

/** 全 absent：什么器官都没有（单器官期的真实状态）。 */
export function noOrgans() {
  return {}
}
