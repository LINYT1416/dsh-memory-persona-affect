// 复核：队列 + 定期调度。
// 对应文档：4.2 / 4.8 "人工确认"、"定期复核"。
// 对应功能总表：A5-6、A5-7、R6。
//
// 两条纪律：
//   1. 没有出口的队列 = 死信。所以必须配 drain / resolve / 面板。
//   2. 复核不动 gate，只动 confidence 和标记（R6）。

export const REVIEW_TTL = 3 * 24 * 60 * 60 * 1000 // 3 天
export const REVIEW_PERIOD = 90 * 24 * 60 * 60 * 1000 // 90 天一次定期复核

const clamp01 = (n) => Math.max(0, Math.min(1, Number(n) || 0))

export function makeReview(state) {
  if (!state.reviewQueue) state.reviewQueue = []
  if (!state.reviewResolved) state.reviewResolved = []
  if (!state.lastSweep) state.lastSweep = 0

  function enqueue({ id = null, subject = null, reason = 'unknown', delta = 0, score = 0, at = Date.now() } = {}) {
    // 去重：同 subject 同原因只留一条
    const dup = state.reviewQueue.find((r) => r.subject === subject && r.reason === reason)
    if (dup) {
      dup.hits = (dup.hits || 1) + 1
      dup.at = at
      return dup
    }
    const row = {
      v: 1,
      id,
      subject,
      reason,
      delta: Number(delta) || 0,
      score: Number(score) || 0,
      at,
      expireAt: at + REVIEW_TTL,
      state: 'pending',
      hits: 1,
    }
    state.reviewQueue.push(row)
    if (state.reviewQueue.length > 200) state.reviewQueue.shift()
    return row
  }

  /** 取待办。过期的标 expired，不删。 */
  function drain({ now = Date.now(), limit = 20 } = {}) {
    for (const row of state.reviewQueue) {
      if (row.state === 'pending' && now > row.expireAt) {
        row.state = 'expired'
        row.expiredAt = now
      }
    }
    return state.reviewQueue
      .filter((r) => r.state === 'pending')
      .sort((a, b) => b.at - a.at)
      .slice(0, limit)
  }

  /**
   * 处理一条。
   * action: 'kept'（保持不变）| 'downgraded'（只降 confidence）
   * 注意：不自动改分、不自动改 gate —— 宁可不动，不要乱动。
   */
  function resolve(id, { action = 'kept', now = Date.now(), note = '' } = {}) {
    const row = state.reviewQueue.find((r) => r.id === id || r.subject === id)
    if (!row) return null
    row.state = action
    row.resolvedAt = now
    row.note = note
    state.reviewResolved.push({ ...row })
    if (state.reviewResolved.length > 200) state.reviewResolved.shift()
    return row
  }

  /**
   * 定期复核：每 90 天扫一遍。
   * 只看"高确信 + 高漂移 + 被复述过"的条目，产出复核单，不自动改分。
   */
  async function sweepReview({ now = Date.now(), candidates = [], force = false } = {}) {
    if (!force && state.lastSweep && now - state.lastSweep < REVIEW_PERIOD) {
      return { ran: false, nextAt: state.lastSweep + REVIEW_PERIOD, queued: 0 }
    }
    state.lastSweep = now
    let queued = 0
    for (const c of candidates) {
      if (!c?.subject) continue
      enqueue({
        subject: c.subject,
        reason: c.reason || 'periodic',
        delta: 0,
        score: clamp01(c.confidence ?? 0),
        at: now,
      })
      queued += 1
    }
    return { ran: true, queued, at: now }
  }

  function stats() {
    const pending = state.reviewQueue.filter((r) => r.state === 'pending').length
    const expired = state.reviewQueue.filter((r) => r.state === 'expired').length
    return {
      pending,
      expired,
      resolved: state.reviewResolved.length,
      lastSweep: state.lastSweep,
      nextSweepAt: state.lastSweep ? state.lastSweep + REVIEW_PERIOD : null,
    }
  }

  return { enqueue, drain, resolve, sweepReview, stats }
}


/**
 * 闪光灯复核判据（4.5）：确信度高 ≠ 准确。
 * 主人定稿：confidence ≥ 0.85 且 salience ≥ 0.5 才进复核队列。
 * 只看 salience 会把“很醒目但没把握”的东西漏掉；只看 confidence 会漏掉“记得很清”。
 */
export const REVIEW_CONF_MIN = 0.85
export const REVIEW_SAL_MIN = 0.5

export function isReviewCandidate({ confidence = 0, score = 0 } = {}) {
  return Number(confidence) >= REVIEW_CONF_MIN && Number(score) >= REVIEW_SAL_MIN
}
