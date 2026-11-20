// 模式分离：情境指纹 + 三档判定。
// 对应功能总表：L1-3 三档分离、L1-15 指纹索引、C12 分离在编码端、R1 双门顺序。
import { sha16 } from './util.js'

/**
 * 指纹 = (会话, 本地日, 小时桶, 前三个实体)。
 * 不用 embedding 做指纹：那是“相似即命中”的老路；指纹只做分桶。
 */
export function makeFingerprint(session, ts, entities = []) {
  const day = new Date(ts).toISOString().slice(0, 10)
  const hour = String(new Date(ts).getHours()).padStart(2, '0')
  const head = [...new Set(entities.map((e) => String(e).toLowerCase()))]
    .filter(Boolean)
    .sort()
    .slice(0, 3)
    .join('|')
  return sha16(`${session}::${day}::${hour}::${head}`)
}

/** 指纹的桶键：索引用它，避免扫全表（L1-15）。 */
export function bucketKey(session, ts) {
  const day = new Date(ts).toISOString().slice(0, 10)
  const hour = String(new Date(ts).getHours()).padStart(2, '0')
  return `${session}::${day}::${hour}`
}

export function entityOverlap(a = [], b = []) {
  const sa = new Set(a.map((x) => String(x).toLowerCase()))
  const sb = new Set(b.map((x) => String(x).toLowerCase()))
  let hit = 0
  for (const x of sa) if (sb.has(x)) hit += 1
  return hit
}

/**
 * 三档判定（L1-3）：
 *  duplicate  同文本 + 同会话，已存在 → 丢弃
 *  same      同会话、时间近、实体重合 ≥ 2 → 并进已有 episode
 *  similar   实体有重合但情境不同 → 新建 + similarTo 弱边
 *  distinct  都没撞上 → 新建
 */
export function classify(newItem, candidates = [], { gapMs = 20 * 60 * 1000 } = {}) {
  const text = String(newItem.text || '')
  for (const old of candidates) {
    if (old.hash === newItem.hash) return { kind: 'duplicate', id: old.episodeId }
  }
  let bestSame = null
  let bestSameScore = 0
  let bestSimilar = null
  let bestSimilarScore = 0
  for (const old of candidates) {
    const overlap = entityOverlap(newItem.entities, old.entities)
    if (overlap <= 0) continue
    const dt = Math.abs(Number(newItem.at) - Number(old.at))
    const near = dt <= gapMs
    const score = overlap
    if (near && overlap >= 2 && score > bestSameScore) {
      bestSame = old
      bestSameScore = score
    } else if (!near && score > bestSimilarScore) {
      bestSimilar = old
      bestSimilarScore = score
    }
  }
  if (bestSame) return { kind: 'same', id: bestSame.episodeId, overlap: bestSameScore }
  if (bestSimilar) return { kind: 'similar', id: bestSimilar.episodeId, overlap: bestSimilarScore }
  return { kind: 'distinct' }
}

/** 从旧 episode 行构造比较用的候选。 */
export function candidateOf(ep) {
  return {
    episodeId: ep.id,
    hash: ep.textHash || '',
    entities: ep.entities || [],
    at: Number(ep.start || 0),
  }
}
