// 巩固优先级：谁先被重放。
// 以前巩固只按时间顺序扫（老的先跑），等于"先到先得"，跟重要性无关。
// 这里给出一个可解释的分数：显著 · 新近 · 实体热度 · 置信度。
// 设计原则：可审计——每一分都能说出理由，不调模型，纯算术。

const DAY = 24 * 60 * 60 * 1000

/** 新近度：半衰 3 天，越新越接近 1 */
export function recencyScore(start, now = Date.now(), halfLifeMs = 3 * DAY) {
  const age = Math.max(0, now - Number(start || now))
  return Math.pow(0.5, age / halfLifeMs)
}

/** 实体热度：这个词最近出现得越多，说明正被反复提起 */
export function entityHeat(entities = [], allEpisodes = [], now = Date.now(), windowMs = 3 * DAY) {
  if (!entities.length) return 0
  let hits = 0
  for (const ep of allEpisodes) {
    if (now - Number(ep.start || 0) > windowMs) continue
    if ((ep.entities || []).some((e) => entities.includes(e))) hits += 1
  }
  // 5 条以内线性，超过封顶
  return Math.min(1, hits / 5)
}

/** 单条 episode 的巩固优先级（0~1） */
export function consolidationScore(ep, { now = Date.now(), heat = null, allEpisodes = [] } = {}) {
  const sal = Number.isFinite(Number(ep?.salience)) ? Number(ep.salience) : 0.3
  const conf = Number.isFinite(Number(ep?.confidence)) ? Number(ep.confidence) : 0.6
  const rec = recencyScore(ep?.start, now)
  const h = heat === null ? entityHeat(ep?.entities || [], allEpisodes, now) : heat
  const score = 0.5 * sal + 0.2 * rec + 0.2 * h + 0.1 * conf
  return {
    score: Number(score.toFixed(4)),
    parts: {
      salience: Number(sal.toFixed(3)),
      recency: Number(rec.toFixed(3)),
      heat: Number(h.toFixed(3)),
      confidence: Number(conf.toFixed(3)),
    },
  }
}

/**
 * 选出这一批要巩固的，再按时间排序重放。
 * 两步是有意的：先用重要性挑人，再用时间轴讲事——不然故事是乱的。
 */
export function orderForConsolidation(episodes = [], { now = Date.now(), limit = 10, allEpisodes = null } = {}) {
  const pool = allEpisodes || episodes
  const scored = episodes.map((ep) => ({ ep, ...consolidationScore(ep, { now, allEpisodes: pool }) }))
  scored.sort((a, b) => b.score - a.score || (a.ep.start || 0) - (b.ep.start || 0))
  const picked = scored.slice(0, limit)
  picked.sort((a, b) => (a.ep.start || 0) - (b.ep.start || 0))
  return picked.map((x) => x.ep)
}

/**
 * 互证：后来的记忆里出现同样实体，说明前面那条被印证了。
 * 关键：用"基础分 + 步长 × 印证数"算，不是每次往上加 —— 否则同一批反复跑会把所有东西顶到天花板。
 * 同一个印证者重复出现不计数（去重），所以这个函数是幂等的。
 */
export function corroborate(ep, priorEpisodes = [], { step = 0.03, cap = 0.95 } = {}) {
  const ents = ep?.entities || []
  if (!ents.length) return { matched: [], step }
  const matched = []
  for (const p of priorEpisodes) {
    if (!p || p.id === ep.id) continue
    if (!(p.entities || []).some((e) => ents.includes(e))) continue
    const base = Number.isFinite(Number(p.confidenceBase)) ? Number(p.confidenceBase) : 0.7
    const seen = new Set(Array.isArray(p.corroboratedBy) ? p.corroboratedBy : [])
    seen.add(ep.id)
    const after = Math.min(cap, Number((base + step * seen.size).toFixed(2)))
    matched.push({ id: p.id, before: Number(p.confidence), after, count: seen.size })
  }
  return { matched, step }
}
