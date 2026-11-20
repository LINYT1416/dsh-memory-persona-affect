// 概念召回（F41、R19）：与 F33 共用同一份语义索引，不建第二套。
// 给海马体 L3-1 补第四路 RRF。
import { search } from './match.js'

export function recall(cells, query, { k = 5 } = {}) {
  // 只召回语义层/规律层，不召回纯推断
  const pool = cells.filter((c) => c.layer === 'semantic' || c.tags?.includes('pattern'))
  const { hits, mode } = search(pool, query, { mode: 'auto', k })
  return {
    query,
    mode,
    items: hits.map((h, i) => ({
      id: h.cellId,
      score: Number((1 / (i + 1)).toFixed(4)),
      why: 'cortex-concept',
      text: h.text,
      // E5：概念召回也要能追回 episode
      supportIds: [...(h.supportIds || [])],
    })),
  }
}

/** 概念清单：去重后的谓词-客体对（给面板/调试用）。 */
export function conceptList(cells, limit = 100) {
  const seen = new Set()
  const out = []
  // 同一主体+谓词只留最新一条（威海→青岛：新事实覆盖旧值；旧条目仍在 cells 里，冲突队列负责裁决）
  const ordered = [...cells].sort((a, b) => Number(b.lastSeen || 0) - Number(a.lastSeen || 0))
  for (const c of ordered) {
    if (c.retracted) continue
    const key = `${c.subject || ''}|${c.predicate}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push({ predicate: c.predicate, object: c.object, confidence: c.confidence, kind: c.kind })
    if (out.length >= limit) break
  }
  return out
}
