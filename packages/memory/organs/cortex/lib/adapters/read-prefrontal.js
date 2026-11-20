// 上游 · 前额叶（F36）：取检索目标、抑制信号、反话判定、冲突裁决。
// 没有就用规则桩；有就用它，但超时吃默认（50ms）。
import { isNegative } from '../util.js'
import { withTimeout } from './read-hippocampus.js'

export function wrapPrefrontal(api) {
  const has = (name) => api && typeof api[name] === 'function'
  // 前额叶的真实 API 叫 gate / judge；旧契约叫 shouldRemember / verify。
  // 两个名字都认，接哪一版都能用。
  const gateFn = has('shouldRemember') ? api.shouldRemember : (has('gate') ? api.gate : null)
  const verifyFn = has('verify') ? api.verify : (has('judge') ? api.judge : null)
  return {
    available: Boolean(api),
    async plan(query) {
      if (has('plan')) {
        try {
          const out = await withTimeout(Promise.resolve(api.plan(query)), 50, null)
          if (typeof out === 'string') return { intent: 'ask', mode: out, filters: {} }
          if (out) return out
        } catch { /* 规则 */ }
      }
      return { intent: 'ask', mode: /["“”「」]|\d{3,}/.test(query) ? 'separate' : 'complete', filters: {} }
    },
    async verify(items) {
      if (verifyFn) {
        try {
          const out = await withTimeout(Promise.resolve(verifyFn(items)), 200, null)
          if (Array.isArray(out)) return { accepted: out, rejected: [], reasons: [], verified: true }
          if (out && Array.isArray(out.verdicts)) {
            return { accepted: out.verdicts, rejected: out.suppressed || [], reasons: [], verified: true }
          }
          if (out && (out.accepted || out.rejected)) return { ...out, verified: true }
        } catch { /* 不校验 */ }
      }
      return null
    },
    async truthfulness(text) {
      if (has('truthfulness')) {
        try {
          const out = await withTimeout(Promise.resolve(api.truthfulness(text)), 50, null)
          if (typeof out === 'number') return { score: out, reason: 'prefrontal', v: 1 }
          if (out) return out
        } catch { /* 规则 */ }
      }
      return { score: isNegative(text) ? 0.25 : 0.65, reason: 'rule', v: 1 }
    },
    async resolveConflict(a, b) {
      if (has('resolveConflict')) {
        try {
          const out = await withTimeout(Promise.resolve(api.resolveConflict(a, b)), 50, null)
          if (out) return out
        } catch { /* 不裁决 */ }
      }
      return { winner: 'neither', reason: 'no-prefrontal' }
    },
    async shouldRemember(text) {
      if (gateFn) {
        try {
          const out = await withTimeout(Promise.resolve(gateFn(text, { role: 'user' })), 50, null)
          if (out && typeof out === 'object') {
            return { ok: out.keep !== false, reason: out.reason || 'prefrontal-gate', depth: out.depth }
          }
        } catch { /* 默认过 */ }
      }
      return { ok: true, reason: 'rule' }
    },
  }
}
