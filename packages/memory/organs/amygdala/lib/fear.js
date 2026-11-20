// 恐惧学习：一次配对，cue 和 context 分开。
// 对应文档：4.3 恐惧条件化、情境恐惧依赖海马。
// 对应功能总表：A3-1、A3-2、A3-3。
//
// cue  = 怕这个东西（"前任""那个项目"）
// context = 怕这个场景（那个房间、那段时间）
// 两者 key 不能混，混了就分不清"怕这件事"还是"怕这个地方"。

export const AVERSION_HALF_DAYS = 30
const DAY = 24 * 60 * 60 * 1000

const clamp01 = (n) => Math.max(0, Math.min(1, Number(n) || 0))

export function keyOf(subject, kind = 'cue') {
  const s = String(subject || '').trim().toLowerCase()
  if (!s) return ''
  return `${kind}:${s}`
}

export function makeFear(state) {
  if (!state.aversion) state.aversion = new Map()

  /** 一次配对就够（4.3）。 */
  function learnCue(subject, { at = Date.now(), strength = 0.8, byId = null, polarity = -1 } = {}) {
    const key = keyOf(subject, 'cue')
    if (!key) return null
    const prev = state.aversion.get(key)
    const next = {
      v: 1,
      key, // 落盘后要靠它回填 Map（以前没有这个字段，写进去也读不回来）
      kind: 'cue',
      subject,
      strength: clamp01(Math.max(Number(prev?.strength || 0), strength)),
      at: prev?.at || at,
      lastAt: at,
      hits: (prev?.hits || 0) + 1,
      byId,
      polarity,
    }
    state.aversion.set(key, next)
    return next
  }

  /** 情境恐惧：key 用 session/place，需要海马给情境（A3-2 标 ○）。 */
  function learnContext({ session = '', place = '', at = Date.now(), strength = 0.7, byId = null } = {}) {
    const raw = `${session || ''}|${place || ''}`
    if (!raw.replace('|', '')) return null
    const key = keyOf(raw, 'context')
    const prev = state.aversion.get(key)
    const next = {
      v: 1,
      key,
      kind: 'context',
      subject: raw,
      session,
      place,
      strength: clamp01(Math.max(Number(prev?.strength || 0), strength)),
      at: prev?.at || at,
      lastAt: at,
      hits: (prev?.hits || 0) + 1,
      byId,
    }
    state.aversion.set(key, next)
    return next
  }

  /** 安全条目：消退时新建，不删旧的（A3-3）。 */
  function safety(subject, { at = Date.now(), byId = null, kind = 'cue' } = {}) {
    const key = keyOf(subject, kind)
    if (!key) return null
    const rows = state.safetyList || (state.safetyList = [])
    const row = { v: 1, kind: 'safety', subject, key, at, byId }
    rows.push(row)
    if (rows.length > 500) rows.splice(0, rows.length - 500)
    return row
  }

  /** 当前强度：30 天半衰。 */
  function strengthOf(subject, { now = Date.now(), kind = 'cue' } = {}) {
    const row = state.aversion.get(keyOf(subject, kind))
    if (!row) return 0
    const ageDays = Math.max(0, (now - Number(row.lastAt || row.at)) / DAY)
    return Number(clamp01(row.strength * Math.pow(0.5, ageDays / AVERSION_HALF_DAYS)).toFixed(4))
  }

  /** 有没有安全条目：有的话 caution 要降下来。 */
  function hasSafety(subject, { kind = 'cue' } = {}) {
    const key = keyOf(subject, kind)
    return (state.safetyList || []).some((r) => r.key === key)
  }

  /**
   * 给生成端的 caution 标签（A3-5 的输出侧）。
   * 只标记，不过滤 —— 文档要求"不拦截，只提示"。
   * kind 支持 cue / context 两种（A3-2 的出口）。
   */
  function cautionOf(subject, { now = Date.now(), gateFactor = 1, kind = 'cue' } = {}) {
    const raw = strengthOf(subject, { now, kind })
    if (raw <= 0.05) return null
    const safe = hasSafety(subject, { kind })
    // gate.expression 压的是"表达"，不是"记忆"（A3-5）
    const level = clamp01(raw * (safe ? 0.4 : 1) * gateFactor)
    if (level <= 0.05) return null
    const row = state.aversion.get(keyOf(subject, kind))
    return {
      subject,
      level: Number(level.toFixed(3)),
      since: row?.at || now,
      kind,
      note: '只提示，不拦截',
    }
  }

  function list(limit = 20) {
    return [...state.aversion.values()]
      .sort((a, b) => b.strength - a.strength)
      .slice(0, limit)
  }

  return { learnCue, learnContext, safety, strengthOf, hasSafety, cautionOf, list, keyOf }
}


/**
 * 消退（4.3）：不删除恐惧关联，只把强度压到 0 并留下更正记录。
 * 文档要求"更正而非删除"——删了就没有历史，复发时也无从判断。
 */
export function extinguish(state, subject, { at = Date.now(), reason = '', kind = 'cue' } = {}) {
  const key = keyOf(subject, kind)
  if (!key || !state.aversion) return null
  const cur = state.aversion.get(key)
  if (!cur) return null
  const next = { ...cur, strength: 0, extinguishedAt: at, reason }
  state.aversion.set(key, next)
  state.corrections ||= []
  state.corrections.push({ at, key, subject, reason, strengthBefore: cur.strength })
  return next
}
