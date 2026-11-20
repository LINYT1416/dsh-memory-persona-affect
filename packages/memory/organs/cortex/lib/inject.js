// 注入供给（F40、R11）：索引进上下文，内容按需取。
// 两段：皮层段给“懂”，海马体段给“记得”（后者由调用方拼）。
import { clockText } from './util.js'

export const DEFAULT_BUDGET = 800

export function scoreOf(cell, now = Date.now()) {
  const days = Math.max(0, (now - Number(cell.lastSeen || now)) / 86400000)
  const recency = Math.pow(0.5, days / 30)
  const conf = Number(cell.confidence || 0.5)
  const weight = Math.min(1.5, Number(cell.weight || 1))
  // F37 显著性参与注入排序；R7：不和 confidence 互乘，只做排序因子
  const salience = 0.6 + 0.4 * Math.min(1, Math.max(0, Number(cell.salience ?? 0.5)))
  return recency * conf * weight * salience
}

/** 皮层段：事实/偏好优先，推断最后。 */
export function compose(cells, { budget = DEFAULT_BUDGET, now = Date.now(), limit = 8 } = {}) {
  const pool = cells
    .filter((c) => !c.retracted && !c.archived)
    .sort((a, b) => scoreOf(b, now) - scoreOf(a, now))
  const picked = []
  let used = 0
  for (const c of pool) {
    if (picked.length >= limit) break
    const line = `- ${c.text}（${c.state === 'fact' ? '记得' : '可能'}，${clockText(c.lastSeen)}）`
    if (used + line.length > budget) break
    if (picked.some((p) => p.text === c.text)) continue
    picked.push({ id: c.id, text: line })
    used += line.length
  }
  if (!picked.length) return { text: '', ids: [], used: 0 }
  const text = [
    '【皮层·她记得的】',
    ...picked.map((p) => p.text),
    '（这是提炼过的事实，不是原话。问细节如果这里没有，就说想不起来，别编。）',
  ].join('\n')
  return { text, ids: picked.map((p) => p.id), used }
}

/** 两段拼接：皮层 + 海马体（R11 预算分开算）。 */
export function combine({ cortex = '', hippocampus = '', budget = DEFAULT_BUDGET * 2 } = {}) {
  const parts = [cortex, hippocampus].filter(Boolean)
  const text = parts.join('\n\n')
  return { text: text.slice(0, budget), truncated: text.length > budget }
}
