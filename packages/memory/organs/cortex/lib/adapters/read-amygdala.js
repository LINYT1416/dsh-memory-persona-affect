// 上游调制 · 杏仁核（F37）：取显著性、优先级，用来调学习率和注入排序。
import { withTimeout } from './read-hippocampus.js'

export function wrapAmygdala(api) {
  const has = (name) => api && typeof api[name] === 'function'
  return {
    available: Boolean(api),
    async salience(text) {
      if (has('salience')) {
        try {
          const out = await withTimeout(Promise.resolve(api.salience(text)), 50, null)
          if (typeof out === 'number') return { score: out, arousal: 0.5, source: 'amygdala', reason: 'real' }
          if (out) return out
        } catch { /* 规则 */ }
      }
      const s = String(text || '')
      let score = 0.4
      if (/[！!]/.test(s)) score += 0.2
      if (/(喜欢|讨厌|难过|开心|怕|气|烦|累)/.test(s)) score += 0.2
      if (s.length > 60) score += 0.1
      return { score: Math.min(1, score), arousal: 0.5, source: 'rule', reason: 'heuristic' }
    },
    async priority(cell) {
      if (has('priority')) {
        try {
          const out = await withTimeout(Promise.resolve(api.priority(cell)), 50, null)
          if (typeof out === 'number') return { score: out, reason: 'amygdala' }
          if (out) return out
        } catch { /* 规则 */ }
      }
      return { score: Number(cell.salience || 0.5), reason: 'rule' }
    },
  }
}
