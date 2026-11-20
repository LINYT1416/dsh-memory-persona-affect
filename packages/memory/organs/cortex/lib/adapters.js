// 器官接入层：组装四个上游/下游适配器 + 能力协商。
// 具体实现分在 adapters/ 下，各管一个方向。
import { wrapHippocampus } from './adapters/read-hippocampus.js'
import { wrapPrefrontal } from './adapters/read-prefrontal.js'
import { wrapAmygdala } from './adapters/read-amygdala.js'

export const CONTRACT_VERSION = 1

export function makeAdapters(ctx, { hippocampus, prefrontal, amygdala } = {}) {
  const get = (name) => {
    try { return ctx?.get?.(name) ?? null } catch { return null }
  }
  // 版本不匹配就拒收（R21：不猜，记日志）
  const accept = (api) => {
    if (!api) return null
    if (api.v && api.v !== CONTRACT_VERSION) return { __rejected: true, v: api.v }
    return api
  }
  const raw = {
    hippocampus: hippocampus !== undefined ? hippocampus : get('memory.hippocampus'),
    prefrontal: prefrontal !== undefined ? prefrontal : get('memory.prefrontal'),
    amygdala: amygdala !== undefined ? amygdala : get('memory.amygdala'),
  }
  const picked = {
    hippocampus: accept(raw.hippocampus),
    prefrontal: accept(raw.prefrontal),
    amygdala: accept(raw.amygdala),
  }
  const ok = (api) => api && !api.__rejected

  return {
    hippocampus: wrapHippocampus(ok(picked.hippocampus) ? picked.hippocampus : null),
    prefrontal: wrapPrefrontal(ok(picked.prefrontal) ? picked.prefrontal : null),
    amygdala: wrapAmygdala(ok(picked.amygdala) ? picked.amygdala : null),
    capabilities: {
      v: CONTRACT_VERSION,
      hippocampus: Boolean(ok(picked.hippocampus)),
      prefrontal: Boolean(ok(picked.prefrontal)),
      amygdala: Boolean(ok(picked.amygdala)),
      rejected: Object.entries(picked).filter(([, a]) => a?.__rejected).map(([k, a]) => ({ organ: k, v: a.v })),
    },
  }
}

/** 能力协商：不仅要对象在，还要方法在（防“器官在但只实现一半”）。 */
export function capabilityReport(adapters) {
  const list = []
  const require = (organ, method) => {
    const ok = Boolean(adapters?.[organ]?.available) && typeof adapters[organ][method] === 'function'
    list.push({ organ, method, ok })
    return ok
  }
  require('hippocampus', 'episodes')
  require('hippocampus', 'traces')
  require('prefrontal', 'plan')
  require('prefrontal', 'verify')
  require('amygdala', 'salience')
  const pref = Boolean(adapters?.prefrontal?.available)
  const amyg = Boolean(adapters?.amygdala?.available)
  return {
    v: CONTRACT_VERSION,
    // L1 只有海马体；L2 多一个（杏仁核或前额叶）；L3 两个都齐
    level: pref && amyg ? 'L3' : (pref || amyg ? 'L2' : 'L1'),
    vectorReady: Boolean(adapters?.hippocampus?.vectorReady),
    list,
  }
}
