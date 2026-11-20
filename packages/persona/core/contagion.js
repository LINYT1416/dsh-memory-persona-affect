// E10 情绪传染：对方什么调子，她会被带过去一点；但不会被完全带走
import { readAir } from './air.js'

const SHIFTS = {
  angry: -0.12,
  venting: -0.08,
  playful: 0.06,
  serious: 0,
  casual: 0,
}

/**
 * @param {string} text 对方的话
 * @returns {{ delta:number, from:string, because:string }}
 */
export function contagion(text = '') {
  const air = readAir(String(text || ''))
  const base = SHIFTS[air.air]
  if (!Number.isFinite(base)) return { delta: 0, from: air.air, because: 'unknown' }
  if (base === 0) return { delta: 0, from: air.air, because: 'neutral' }
  // 传染有上限：对方再炸，也只被带一点
  const delta = Math.max(-0.12, Math.min(0.06, base))
  return { delta, from: air.air, because: 'caught' }
}
