// 三态适配层：所有跨器官调用都必须从这里走。
// 铁律（C4）：value / unknown / absent 三种返回，不许用 null 或 0 顶替。
// 时间预算（C3）：T0 的调用一律 0ms 同步；异步的一律进缓存，不回传本轮。

export const TRI = { value: 'value', unknown: 'unknown', absent: 'absent' }

export function absent(name) {
  return { tri: TRI.absent, name, value: null }
}

export function unknown(name, why = '') {
  return { tri: TRI.unknown, name, value: null, why }
}

export function ok(name, value) {
  return { tri: TRI.value, name, value }
}

/** 把任意返回值折成三态：undefined/null/'absent' → absent；'unknown' → unknown。 */
export function wrap(name, raw) {
  if (raw === undefined || raw === null || raw === 'absent') return absent(name)
  if (raw === 'unknown') return unknown(name)
  if (raw && typeof raw === 'object' && raw.tri) return raw
  return ok(name, raw)
}

/** 同步调用（T0 专用）：不许 await，不许 timeout —— 拿不到就是 absent。 */
export function callSync(name, fn, ...args) {
  if (typeof fn !== 'function') return absent(name)
  try {
    return wrap(name, fn(...args))
  } catch (e) {
    return unknown(name, String(e?.message || e))
  }
}

/** 异步调用（T1/T3）：带 deadline，超时记 unknown（不是 absent——器官在，只是没赶上）。 */
export async function callAsync(name, fn, { deadline = 300, args = [] } = {}) {
  if (typeof fn !== 'function') return absent(name)
  try {
    const p = Promise.resolve().then(() => fn(...args))
    const t = new Promise((resolve) => setTimeout(() => resolve(Symbol.for('timeout')), deadline))
    const r = await Promise.race([p, t])
    if (r === Symbol.for('timeout')) return unknown(name, `超时 ${deadline}ms`)
    return wrap(name, r)
  } catch (e) {
    return unknown(name, String(e?.message || e))
  }
}

function seamOf(organs, group, key) {
  return organs?.[group]?.[key]
}

/** 组装一组同步面（judge 用）。缺的就是 absent。 */
export function syncSeams(organs = {}) {
  return {
    episode: (id) => {
      const fn = seamOf(organs, 'hippocampus', 'episode')
      return callSync('mem.episode', fn, id)
    },
    source: (id) => {
      const fn = seamOf(organs, 'hippocampus', 'source')
      return callSync('mem.source', fn, id)
    },
    conflicts: () => {
      const fn = seamOf(organs, 'hippocampus', 'conflicts')
      return callSync('mem.conflicts', fn)
    },
    traces: () => {
      const fn = seamOf(organs, 'hippocampus', 'traces')
      return callSync('mem.traces', fn)
    },
    salience: (text, ctx) => {
      const fn = seamOf(organs, 'amygdala', 'salience')
      return callSync('amy.salience', fn, text, ctx)
    },
    weight: (id) => {
      const fn = seamOf(organs, 'amygdala', 'weight')
      return callSync('amy.weight', fn, id)
    },
    adjust: (id, payload) => {
      const fn = seamOf(organs, 'amygdala', 'adjust')
      return callSync('amy.adjust', fn, id, payload)
    },
    concepts: (text) => {
      const fn = seamOf(organs, 'cortex', 'concepts')
      return callSync('cog.concepts', fn, text)
    },
    contradicts: (a, b) => {
      const fn = seamOf(organs, 'cortex', 'contradicts')
      if (typeof fn !== 'function') return absent('cog.contradicts')
      try {
        const r = fn(a, b)
        // 语义面返回的是结论对象，不是相似度——这是"决策权交出去"的物理保证
        if (!r || r === 'unknown') return unknown('cog.contradicts')
        return ok('cog.contradicts', r)
      } catch (e) {
        return unknown('cog.contradicts', String(e?.message || e))
      }
    },
    cogSearch: (query, opts) => {
      const fn = seamOf(organs, 'cortex', 'search')
      return callSync('cog.search', fn, query, opts)
    },
    summarize: (items) => {
      const fn = seamOf(organs, 'cortex', 'summarize')
      return callSync('cog.summarize', fn, items)
    },
    constrain: (draft, rules) => {
      const fn = seamOf(organs, 'generate', 'constrain')
      return callSync('gen.constrain', fn, draft, rules)
    },
    state: () => {
      const fn = seamOf(organs, 'amygdala', 'state')
      return callSync('amy.state', fn)
    },
  }
}

/** #P4-4 把降权曲线发给杏仁核（不在就是 absent，不假装写成功）。 */
export function amyAdjust(seams, id, payload) {
  if (!seams?.adjust) return absent('amy.adjust')
  return seams.adjust(id, payload)
}

/** 给 judge 的"可用能力"表：没接的不给权重，不给假权重。 */
export function capabilityTable(organs = {}) {
  return {
    vector: Boolean(organs.hippocampus?.vectorReady !== false && organs.hippocampus?.recall),
    graph: Boolean(organs.hippocampus?.recall),
    semantic: Boolean(organs.cortex?.search),
  }
}
