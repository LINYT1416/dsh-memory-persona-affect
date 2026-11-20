// 主动想起：不是等被问，而是"这句话让我想起了什么"。
//
// 跟海马体检索的区别：检索是"你去查"，这里是"它自己冒出来"。
// 门槛故意高——宁可这轮不冒，也别每句都扯旧账（那就不像人了）。
//
// 判据：
// - 关联够强（相似度/融合分过线）
// - 不是刚说过的同一条（冷却期）
// - 太久远、纯流水账的不冒
// - 一轮最多一条

export const DEFAULTS = {
  threshold: 0.55,     // 融合分下限
  cooldownMs: 30 * 60 * 1000,
  maxAgeMs: 90 * 24 * 60 * 60 * 1000,
  staleAgeMs: 14 * 24 * 60 * 60 * 1000,
}

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : null)

/**
 * @param {Array} hits recall 返回的命中
 * @param {{now?:number, surfaced?:Map<string,number>, opts?:object}} ctx
 */
export function pickProactive(hits = [], { now = Date.now(), surfaced = new Map(), opts = {} } = {}) {
  const o = { ...DEFAULTS, ...opts }
  const best = []
  for (const h of hits || []) {
    const id = String(h?.episodeId || h?.id || '')
    if (!id) continue
    const score = num(h?.score) ?? num(h?.rank) ?? num(h?.confidence) ?? 0
    if (score < o.threshold) continue
    const last = Number(surfaced.get(id) || 0)
    if (last && now - last < o.cooldownMs) continue
    const at = num(h?.start) ?? num(h?.at) ?? null
    const age = at ? now - at : 0
    if (age > o.maxAgeMs) continue
    // 流水账（没有摘要、只有很短一句）不值得主动提
    const text = String(h?.summary || h?.text || '').trim()
    if (text.length < 8) continue
    // 太久远又要靠高分才冒：近三天的随便一点，旧的要更硬
    const ageBonus = age > o.staleAgeMs ? -0.12 : 0.05
    best.push({ id, score: score + ageBonus, text, at })
  }
  if (!best.length) return null
  best.sort((a, b) => b.score - a.score)
  return best[0]
}

export function proactiveLine(pick) {
  if (!pick) return ''
  const t = String(pick.text || '').replace(/\s+/g, ' ').slice(0, 60)
  return `她想起一件旧事（可以顺口提一句，也可不提）：${t}`
}
