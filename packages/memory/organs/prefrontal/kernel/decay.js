// #P4-2 消退曲线 / #P4-3 复发再压 / #P4-4 降权请求
// 规矩：渐进、不清零、允许复发（文档 §3.7）。一次清零 = 复发时全回来。
import { clamp } from './text.js'

const STEPS = 5

/**
 * 分期降权曲线：从当前值降到目标值，分 5 步，单步不超过 30%。
 * 返回 [{step, weight, delta}]，执行方是杏仁核（F15）。
 */
export function curve(from, to = 0.2, { steps = STEPS } = {}) {
  const start = clamp(Number(from) || 1)
  const end = clamp(Number(to))
  if (start <= end) return []
  const out = []
  let cur = start
  const stepSize = (start - end) / steps
  for (let i = 1; i <= steps; i += 1) {
    const next = clamp(Math.max(end, cur - stepSize))
    out.push({ step: i, weight: Number(next.toFixed(4)), delta: Number((next - cur).toFixed(4)) })
    cur = next
  }
  return out
}

/** 单步降权：每次最多降 30%，防"一次清零"。 */
export function stepOnce(from, to = 0.2) {
  const start = clamp(Number(from) || 1)
  const end = clamp(Number(to))
  if (start <= end) return { weight: start, changed: false }
  const floorByRate = start * 0.7
  const next = clamp(Math.max(end, floorByRate))
  return { weight: Number(next.toFixed(4)), changed: true }
}

/**
 * #P4-3 复发再压：已降权的条目又被召回 → 再压一次，并记录次数。
 * 复发次数越多，说明"旧关联"越顽固，下次降得更狠一点（但仍有下限）。
 */
export function again(item, ledgerRow = {}) {
  const times = Number(ledgerRow.recur || 0) + 1
  const current = Number(item.weight ?? ledgerRow.weight ?? 1)
  const target = clamp(0.2 / Math.max(1, times * 0.5))
  const next = stepOnce(current, target)
  return { recur: times, weight: next.weight, changed: next.changed, why: `第 ${times} 次复发` }
}

/** 值不值得发降权请求：已经很低、或者刚降过，就不再发（防抖）。 */
export function shouldRequest(weight, lastAt, now = Date.now(), { minGapMs = 3600 * 1000, floor = 0.25 } = {}) {
  if (weight <= floor) return { send: false, why: '已到下限' }
  if (lastAt && now - lastAt < minGapMs) return { send: false, why: '刚降过' }
  return { send: true, why: '该降' }
}
