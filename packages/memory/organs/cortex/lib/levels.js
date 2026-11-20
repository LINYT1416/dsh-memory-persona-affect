// 多级抽象（F08）：具体 / 类型 / 规律三层，双向支撑。
export const LEVELS = ['instance', 'type', 'rule']

export function levelIndex(level) {
  return Math.max(0, LEVELS.indexOf(level))
}

export function nextLevel(level) {
  return LEVELS[Math.min(LEVELS.length - 1, levelIndex(level) + 1)]
}

/** 一条 cell 的抽象层级：偏好/事实算实例，关系算类型，规律要多次才升。 */
export function levelOf(cell) {
  if (cell.kind === 'relation') return 'type'
  if (cell.kind === 'trait') return 'type'
  if ((cell.evidenceCount || 1) >= 3 && cell.kind === 'preference') return 'type'
  if ((cell.evidenceCount || 1) >= 5) return 'rule'
  return 'instance'
}

/** 具体实例支撑抽象，抽象反过来解释具体（双向引用）。 */
export function linkLevels(cells) {
  const out = []
  for (const c of cells) {
    const level = levelOf(c)
    if (level === 'instance') continue
    const parents = cells.filter((x) => x !== c && x.id !== c.id && x.kind === c.kind
      && levelOf(x) === 'instance' && x.predicate === c.predicate)
    if (parents.length) out.push({ id: c.id, level, supports: parents.map((p) => p.id) })
  }
  return out
}
