// X10 道歉方式 + R08 冲突与和解
// 规格：X10「道歉方式」、R08「冲突与和解」
// 人设要求：道歉干脆、不反复。所以这里的关键不是"会不会道歉"，而是"道过就不再念叨"。

const COOLDOWN = 30 * 60 * 1000

/**
 * @param {object} reads 六器官读数
 * @param {object} rel   关系账本快照 { debt, intimacy, hurts, lastHurtAt, lastApologyAt }
 * @param {object} state 持久状态 { lastApologizedAt, pendingRepair }
 * @param {number} now
 * @returns {{ action: 'apologize'|'repair'|'hold'|null, line: string|null }}
 */
export function decideRepair(reads = {}, rel = {}, state = {}, now = Date.now()) {
  const n = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0)
  const tpj = reads.tpj || {}
  const acc = reads.acc || {}
  const ofc = reads.ofc || {}

  const hurtNow = n(tpj.offense) > 0.45 || n(acc.error) > 0.45
  const warmNow = n(ofc.warm) > 0.45
  const lastHurtAt = n(rel.lastHurtAt)
  const lastApologizedAt = n(state.lastApologizedAt)
  const pending = Boolean(state.pendingRepair)

  // 道过歉、对方态度软下来：翻篇，不提第二次
  if (pending && warmNow) {
    return { action: 'repair', line: '这事翻篇，不揪着了' }
  }
  // 先判断旧伤：陈年的事不翻，比"立刻道歉"优先
  // 伤发生很久了，还没道歉：别提（宁可漏，不当场翻旧账）
  if (hurtNow && lastHurtAt && now - lastHurtAt > 60 * 60 * 1000) {
    return { action: 'hold', line: null }
  }

  // 刚被怼、道过歉不到半小时：不再道第二次（人设：别反复）
  if ((hurtNow || pending) && now - lastApologizedAt > COOLDOWN) {
    return { action: 'apologize', line: '是我说错了，我认' }
  }
  return { action: null, line: null }
}

export function createRepairState() {
  const s = { lastApologizedAt: 0, pendingRepair: false }
  return {
    decide(reads, rel, now = Date.now()) {
      const r = decideRepair(reads, rel, s, now)
      if (r.action === 'apologize') {
        s.lastApologizedAt = now
        s.pendingRepair = true
      }
      if (r.action === 'repair') s.pendingRepair = false
      return r
    },
    snapshot: () => ({ ...s }),
    restore: (x) => {
      if (!x || typeof x !== 'object') return
      s.lastApologizedAt = Number(x.lastApologizedAt) || 0
      s.pendingRepair = Boolean(x.pendingRepair)
    },
  }
}
