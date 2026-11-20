// #P2-1 来源标签强制 / #P2-2 种类判定 / #P2-3 可信度
// 种类来自海马的 source.kind（F8）；拿不到就是 unknown——不是"推断"，不许猜。
export const KINDS = ['原话', '推断', '外部', '摘要', 'unknown']

const TRUST = { 原话: 1, 外部: 0.75, 摘要: 0.6, 推断: 0.4, unknown: 0.5 }

/**
 * 三态来源：
 *   value   —— 候选自带 kind，或海马体答了
 *   unknown —— 器官在，但答不上来（→ 置信封顶）
 *   absent  —— 没这个接口/没这个字段（→ 走默认 trust，只打 degraded，不封顶）
 * 把 absent 和 unknown 混成一种，结果是"所有分数都被 0.6 压死"，那是错的。
 */
export function ensure(cand, fromSeam = null, seamTri = null) {
  const src = cand?.source || {}
  const hasOwn = KINDS.includes(src.kind)
  const seamKind = fromSeam && KINDS.includes(fromSeam.kind) ? fromSeam.kind : null
  const kind = hasOwn ? src.kind : (seamKind || 'unknown')
  const tri = hasOwn || seamKind ? 'value' : (seamTri === 'unknown' ? 'unknown' : 'absent')
  return {
    kind,
    tri,
    trust: Number.isFinite(src.trust)
      ? src.trust
      : (Number.isFinite(fromSeam?.trust) ? fromSeam.trust : TRUST[kind]),
    channel: src.channel || fromSeam?.channel || cand?.channel || 'unknown',
    from: src.from || null,
    known: tri === 'value',
    viaSeam: !hasOwn && Boolean(seamKind),
  }
}

export function kind(cand, seam) {
  const hit = seam?.source?.(cand?.episodeId) ?? null
  if (!hit || hit === 'absent') return { kind: 'unknown', tri: 'absent' }
  if (hit === 'unknown') return { kind: 'unknown', tri: 'unknown' }
  return { kind: KINDS.includes(hit.kind) ? hit.kind : 'unknown', tri: 'value', detail: hit }
}

export function trust(kindName) {
  return TRUST[kindName] ?? TRUST.unknown
}

/** 来源不该只在一个候选上生效：同一 session 的同一来源要一致。 */
export function uniformize(cands = []) {
  const bySession = new Map()
  for (const c of cands) {
    const s = ensure(c)
    const key = c.session || 'unknown'
    const prev = bySession.get(key)
    if (!prev || s.trust < prev.trust) bySession.set(key, s)
  }
  return cands.map((c) => ({ ...c, source: ensure(c) }))
}
