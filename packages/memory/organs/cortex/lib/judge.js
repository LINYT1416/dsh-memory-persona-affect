// 语义判定（F42）：是不是同一件事、复述 vs 本体。
// 海马体 L1-3、L3-7、L4-3、L5-5 都要这一半。
import { similarity } from './util.js'

/** 两条 cell 是不是同一件事。 */
export function same(a, b) {
  if (!a || !b) return false
  if (a.id === b.id) return true
  if (a.subject === b.subject && a.predicate === b.predicate && a.object === b.object) return true
  return similarity(a.text || '', b.text || '') >= 0.85
}

/** 复述 vs 本体：晚的那条是复述。 */
export function restatement(a, b) {
  if (!same(a, b)) return { restatement: false }
  const newer = (a.firstSeen || 0) >= (b.firstSeen || 0) ? a : b
  const older = newer === a ? b : a
  return { restatement: newer.id !== older.id, bodyId: older.id, restatementId: newer.id }
}

/** 综合判定，带置信度。 */
export function judge(a, b) {
  const isSame = same(a, b)
  const r = isSame ? restatement(a, b) : { restatement: false }
  return {
    same: isSame,
    restatement: Boolean(r.restatement),
    bodyId: r.bodyId || null,
    restatementId: r.restatementId || null,
    confidence: isSame ? 0.9 : 0.1,
  }
}
