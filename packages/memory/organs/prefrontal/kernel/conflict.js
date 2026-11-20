// #P2-4 一致性校验（结构）/ #P2-5 冲突落队 / #P2-6 冲突裁决 / #P2-7 语义矛盾
// 只做结构级：同实体 + 不同值 / 相反极性。语义级一律问 F11，问不到就 unknown。
import { numbersIn, polarity } from './text.js'

/** 结构冲突检出。返回 [{aId,bId,entity,field,values,kind}] */
export function scan(cands = []) {
  const out = []
  const byEntity = new Map()
  for (const c of cands) {
    for (const e of c.entities || []) {
      const key = String(e)
      const list = byEntity.get(key) || []
      list.push(c)
      byEntity.set(key, list)
    }
  }

  for (const [entity, list] of byEntity) {
    if (list.length < 2) continue
    for (let i = 0; i < list.length; i += 1) {
      for (let j = i + 1; j < list.length; j += 1) {
        const a = list[i]
        const b = list[j]
        const pa = polarity(a.summary)
        const pb = polarity(b.summary)
        if (pa !== 0 && pb !== 0 && pa === pb) continue

        if (pa !== 0 && pb !== 0 && pa !== pb) {
          out.push({ aId: a.episodeId, bId: b.episodeId, entity, field: 'polarity', values: [pa, pb], kind: 'polarity' })
          continue
        }
        if (a.place && b.place && a.place !== b.place) {
          out.push({ aId: a.episodeId, bId: b.episodeId, entity, field: 'place', values: [a.place, b.place], kind: 'place' })
          continue
        }
        const na = numbersIn(a.summary)
        const nb = numbersIn(b.summary)
        // 数值冲突最容易误报（实测：两条都提到"重启完了"、数字 4 和 3，被判成数值冲突）。
        // 收紧：必须同一主体（slots.who 都存在且相等）、同一类型，且共有实体不是长句碎片。
        const sameWho = a.slots?.who && b.slots?.who && a.slots.who === b.slots.who
        const sameType = a.type && b.type && a.type === b.type
        const shortEntity = String(entity).length <= 8
        if (na.length && nb.length && na[0] !== nb[0] && sameWho && sameType && shortEntity) {
          out.push({ aId: a.episodeId, bId: b.episodeId, entity, field: 'number', values: [na[0], nb[0]], kind: 'number' })
        }
      }
    }
  }
  return out
}

/**
 * 裁决（#P2-6）：时间 > 来源 > 重复度。
 * 三规则任一条反对，就「只标不裁」——没有 ground truth 时，不许假装知道谁对。
 * 返回 {winner, loser, opinion, decided}
 */
export function adjudicate(pair, ctx = {}) {
  const a = ctx.byId?.(pair.aId)
  const b = ctx.byId?.(pair.bId)
  if (!a || !b) return { winner: null, loser: null, opinion: 'missing', decided: false }

  const votes = []
  const ta = Number(a.at) || 0
  const tb = Number(b.at) || 0
  if (ta !== tb) votes.push(ta > tb ? 'a' : 'b')
  else votes.push('tie')

  const sa = Number(a.source?.trust ?? 0.5)
  const sb = Number(b.source?.trust ?? 0.5)
  if (sa !== sb) votes.push(sa > sb ? 'a' : 'b')
  else votes.push('tie')

  const ra = Number(a.repeat || 1)
  const rb = Number(b.repeat || 1)
  votes.push(ra === rb ? 'tie' : ra > rb ? 'a' : 'b')

  const real = votes.filter((v) => v !== 'tie')
  const agree = real.every((v) => v === real[0])
  if (!real.length) return { winner: null, loser: null, opinion: 'all-tie', decided: false, votes }

  return {
    winner: agree ? real[0] : null,
    loser: agree ? (real[0] === 'a' ? 'b' : 'a') : null,
    opinion: agree ? 'agree' : 'split',
    votes,
    decided: agree, // 只有三条都指同一边才敢定
  }
}

/**
 * 语义矛盾（#P2-7）。三态：皮层不在是 absent，答不了是 unknown。
 * 注意：这里**不许**用相似度兜底——那等于自己判语义（C1 + 越界）。
 */
export function contradicts(a, b, seam) {
  const fn = seam?.contradicts
  if (typeof fn !== 'function') return { tri: 'absent', verdict: 'unknown' }
  try {
    const r = fn(a, b)
    if (!r) return { tri: 'unknown', verdict: 'unknown' }
    if (r === 'unknown') return { tri: 'unknown', verdict: 'unknown' }
    return { tri: 'value', verdict: r.verdict || 'unknown', confidence: r.confidence, why: r.why }
  } catch {
    return { tri: 'unknown', verdict: 'unknown' }
  }
}

/** 冲突是不是"同一条被自己和自己比"，过滤掉。 */
export function dedupe(pairs = []) {
  const seen = new Set()
  const out = []
  for (const p of pairs) {
    const key = [p.aId, p.bId].sort().join('|')
    if (seen.has(key)) continue
    seen.add(key)
    out.push(p)
  }
  return out
}
