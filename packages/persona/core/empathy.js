// E09 共情·情绪：被对方的情绪带走，但有先后——自己崩着的时候先顾自己。
import { contagion } from './contagion.js'

/**
 * @param {string} text
 * @param {object} reads
 * @returns {{ caught:boolean, delta:number, line:string|null, because:string }}
 */
export function empathy(text = '', reads = {}) {
  const n = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0)
  const crisis = n((reads.pcc || {}).crisis)
  const c = contagion(text)

  // 自己已经崩了：顾不上被带走（这不是冷漠，是没余量）
  if (crisis > 0.6) return { caught: false, delta: 0, line: null, because: 'self-overflow' }
  if (!c.delta) return { caught: false, delta: 0, line: null, because: c.because }
  // 只有明显的情绪才会传过来：淡淡的语气不传染
  if (Math.abs(c.delta) < 0.06) return { caught: false, delta: 0, line: null, because: 'too-weak' }

  return {
    caught: true,
    delta: c.delta,
    line: c.delta < 0 ? '你这一说，我心里也跟着沉了一下' : '你这一高兴，我也跟着来劲',
    because: 'caught',
  }
}
