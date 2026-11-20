// 失真：主观生动、确信度 vs 准确度、时间漂移、复述重建、冲突。
// 对应文档：4.5 闪光灯记忆、附 C 第 7 条冲突显式化。
// 对应功能总表：A5-1 ~ A5-5、R4、R7。

const DAY = 24 * 60 * 60 * 1000
const clamp01 = (n) => Math.max(0, Math.min(1, Number(n) || 0))

/** 主观生动度：只由唤醒决定，跟准确度无关。 */
export function vividnessOf(arousal, extreme = false) {
  const a = clamp01(arousal)
  return Number(clamp01(a * 0.7 + (extreme ? 0.3 : 0)).toFixed(3))
}

/**
 * 两个数朝相反方向走：
 *   confidence（可信）会随时间掉
 *   certainty（确信）不会掉，甚至更高
 * R7：confidence 只由"来源信任 - 漂移"决定，vividness 不进去。
 */
export function split(trust, vividness, ageDays = 0) {
  const conf = clamp01(trust)
  const drift = driftOf(ageDays)
  const confidence = Number(clamp01(conf - drift).toFixed(3))
  const certainty = Number(clamp01(conf + vividness * 0.3).toFixed(3))
  return {
    confidence,
    certainty,
    vividness: Number(clamp01(vividness).toFixed(3)),
    drift: Number(drift.toFixed(3)),
  }
}

/** 时间漂移：半年最多掉 0.25。 */
export function driftOf(ageDays) {
  const d = Math.max(0, Number(ageDays) || 0)
  return Math.min(0.25, (d / 180) * 0.25)
}

/** 准确度：确信度不参与。 */
export function accuracyOf(trust, ageDays) {
  return Number(clamp01(Number(trust) - driftOf(ageDays)).toFixed(3))
}

export function makeFidelity(state) {
  if (!state.fidelity) state.fidelity = new Map()
  if (!state.conflicts) state.conflicts = []

  function ensure(key) {
    if (!state.fidelity.has(key)) {
      state.fidelity.set(key, { v: 1, revisions: 0, lastHash: null, lastAt: 0, reconstructed: false })
    }
    return state.fidelity.get(key)
  }

  /**
   * 复述重建：同一 subject 再提一次就 +1；摘要指纹变了 = 被重建过。
   * 文档："被一次次重建，越来越符合叙事。"
   */
  function revision(subject, textHash, { at = Date.now() } = {}) {
    const key = String(subject || '').trim().toLowerCase()
    if (!key) return null
    const row = ensure(key)
    row.revisions += 1
    if (row.lastHash && textHash && row.lastHash !== textHash) row.reconstructed = true
    row.lastHash = textHash || row.lastHash
    row.lastAt = at
    return {
      subject,
      revisions: row.revisions,
      reconstructed: row.reconstructed,
      overconfident: row.revisions >= 3,
    }
  }

  /**
   * 冲突判定（R4）：先判"变了"还是"错了"。
   *   间隔 <24h 且值互斥 → 这是更正（correction）
   *   间隔 >24h 且值不同 → 这是变化（conflict），两条都留
   */
  function conflict(subject, value, { at = Date.now(), polarity = 0 } = {}) {
    const key = String(subject || '').trim().toLowerCase()
    if (!key) return { kind: 'none' }
    const row = ensure(key)
    const gap = at - Number(row.lastAt || 0)
    const changed = row.lastValue !== undefined && String(row.lastValue) !== String(value)
    const flipped = Math.sign(Number(polarity)) !== Math.sign(Number(row.lastPolarity || 0))
      && row.lastPolarity !== undefined

    let kind = 'none'
    if (changed || flipped) {
      if (gap < 24 * 60 * 60 * 1000) kind = 'correction'
      else kind = 'conflict'
    }

    // 先记下旧值再覆盖，否则 from 永远等于 to（之前就是这个 bug）
    const prevValue = row.lastValue
    const prevPolarity = row.lastPolarity
    row.lastValue = value
    row.lastPolarity = polarity
    row.lastAt = at

    if (kind === 'conflict') {
      const item = {
        v: 1,
        at,
        subject,
        from: String(prevValue ?? ''),
        to: String(value),
        fromPolarity: Number.isFinite(Number(prevPolarity)) ? Number(prevPolarity) : null,
        polarity,
      }
      state.conflicts.push(item)
      if (state.conflicts.length > 300) state.conflicts.shift()
      return { kind, item }
    }
    return { kind, gap }
  }

  /** 定期复核要问的：这条是不是被判成"高确信但可能失真"。 */
  function reviewCandidate(subject) {
    const row = state.fidelity.get(String(subject || '').trim().toLowerCase())
    if (!row) return null
    if (row.revisions < 3 && !row.reconstructed) return null
    return {
      subject,
      revisions: row.revisions,
      reconstructed: row.reconstructed,
      reason: row.reconstructed ? 'reconstructed' : 'overconfident',
    }
  }

  return { revision, conflict, reviewCandidate, ensure }
}
