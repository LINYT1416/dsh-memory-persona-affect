// 门控：消退的双作用 + 三种复发。
// 对应文档：4.3 消退（压制旧的）+ 三个复发。
// 对应功能总表：A3-4、A3-5、A3-6、A3-7、R5、R6。
//
// 语义要拧清楚：
//   gate = 1   不压制（原样，恐惧照旧）
//   gate = 0.35 最强压制（更正说得很确定）
// 三种复发都是"压制失效"，所以方向都是往 1 回升。
// 这和 PTSD 对得上：消退功能不足 = 压不住 = gate 接近 1。

export const GATE_MIN = 0.35   // 下限：还能被找到，只是排不上（不是 0.2，0.2 会让复发无从解释）
export const GATE_MAX = 1
export const RELAPSE_DAYS = 30  // 自发恢复：30 天回 0.15

const DAY = 24 * 60 * 60 * 1000
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, Number(n) || 0))

export function makeGate(state) {
  if (!state.gates) state.gates = new Map()

  function ensure(targetId) {
    if (!state.gates.has(targetId)) {
      state.gates.set(targetId, {
        v: 1,
        targetId,
        weightSum: 0,
        relapses: 0,
        lastRelapseAt: 0,
        lastSession: null,
        lastScore: 1,
        createdAt: Date.now(),
      })
    }
    return state.gates.get(targetId)
  }

  /** 加一条更正：权重累加，门控变低。 */
  function addCorrection({ targetId, byId = null, kind = 'retract', weight = 0.35, subject = null, at = Date.now() } = {}) {
    if (!targetId) return null
    const g = ensure(targetId)
    g.weightSum = clamp(g.weightSum + Number(weight || 0), 0, 0.95)
    g.kind = kind
    g.byId = byId
    g.subject = subject
    g.updatedAt = at
    return g
  }

  /**
   * 记忆侧门控：乘在检索排序上。
   * 文档 4.3 明写"检索时让更正压制原始（类似 ITC 的门控）"。
   */
  function gateMemory(targetId, { now = Date.now(), session = null } = {}) {
    const g = state.gates.get(targetId)
    if (!g) return 1
    // 先夹到区间再加复发量：否则压过头之后永远抬不起来
    let v = clamp(1 - g.weightSum, GATE_MIN, GATE_MAX)

    // 复发 1：自发恢复（时间）
    // 注意：lastRelapseAt 可能是 0，所以用 relapses 计数判"有没有发生过"
    if (g.relapses > 0 && now - Number(g.lastRelapseAt || 0) > RELAPSE_DAYS * DAY) {
      const steps = Math.floor((now - Number(g.lastRelapseAt || 0)) / (RELAPSE_DAYS * DAY))
      v += 0.15 * Math.min(3, steps)
      g.lastRelapseAt = now // 只补一次，避免每次读都加
    }

    // 复发 2：renewal（换环境）
    if (session && g.lastSession && session !== g.lastSession) {
      v *= 1.2
      g.renewals = (g.renewals || 0) + 1
    }
    if (session) g.lastSession = session

    const out = clamp(v, GATE_MIN, GATE_MAX)
    g.lastScore = Number(out.toFixed(4))
    return g.lastScore
  }

  /**
   * 表达侧门控：压 caution 强度。
   * ITC 压的是 CeA（表达），所以这一路必须单独存在（A3-5）。
   * R5：两者取 min，不叠乘。
   */
  function gateExpression(targetId, { now = Date.now(), session = null } = {}) {
    return gateMemory(targetId, { now, session })
  }

  /**
   * 渐进压：vmPFC 给消退信号时用（文档 3.7「下调要渐进，不能一次清零」）。
   * 注意：这跟 relapse 是反方向 —— relapse 是"又被想起，压制失效"，
   * suppress 是"又给了一次安全证据，压得更狠"。
   */
  function suppress(targetId, { factor = 0.7, at = Date.now() } = {}) {
    const g = ensure(targetId)
    const delta = Math.max(0, Math.min(0.9, 1 - Number(factor)))
    g.weightSum = clamp(g.weightSum + delta, 0, 0.95)
    g.suppressedAt = at
    g.suppressCount = (g.suppressCount || 0) + 1
    return {
      targetId,
      weightSum: Number(g.weightSum.toFixed(4)),
      gate: gateMemory(targetId, { now: at }),
      count: g.suppressCount,
    }
  }

  /**
   * 前额叶给一个 delta：正数=压得更狠，负数=抬回来。
   * 这是 F15 的落点（前额叶算衰减曲线，杏仁核执行）。
   */
  function adjust(targetId, delta) {
    if (!targetId) return { targetId: null, gate: 1, weightSum: 0 }
    const g = ensure(targetId)
    const d = clamp(Number(delta) || 0, -0.5, 0.5)
    g.weightSum = clamp(g.weightSum + d, 0, 0.95)
    g.adjustedAt = Date.now()
    g.adjustCount = (g.adjustCount || 0) + 1
    return {
      targetId,
      gate: gateMemory(targetId, { now: Date.now() }),
      weightSum: Number(g.weightSum.toFixed(4)),
      delta: Number(d.toFixed(4)),
      count: g.adjustCount,
    }
  }

  /** 记录一次复发（被再次想起）。 */
  function relapse(targetId, { now = Date.now(), kind = 'spontaneous' } = {}) {
    const g = ensure(targetId)
    g.relapses += 1
    g.lastRelapseAt = now
    g.lastKind = kind
    return g.relapses
  }

  /** 复发 3：reinstatement。同类负性再现，压制全面失效。 */
  function reinstatement(targetId, { now = Date.now() } = {}) {
    const g = ensure(targetId)
    g.weightSum = 0
    g.lastRelapseAt = now
    g.reinstatedAt = now
    g.lastScore = 1
    return g
  }

  function countRelapse(targetId) {
    return state.gates.get(targetId)?.relapses || 0
  }

  function info(targetId) {
    const g = state.gates.get(targetId)
    if (!g) return null
    return { ...g }
  }

  return {
    addCorrection, gateMemory, gateExpression, suppress, adjust, relapse, reinstatement, countRelapse, info,
  }
}
