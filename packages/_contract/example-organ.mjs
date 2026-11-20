// 骨架示例（不是实现）：给五个窗口当模板。
// 它只做三件事：按 dt 衰减、发一条合法信号、按 txId 去重。
// 真正的杏仁核照 01-杏仁核.md 写，但接口形状和这里必须一模一样。

import { CONTRACT_VERSION } from './contract.mjs'

const ID = 'affect.amygdala'

const params = {
  tauThreatMin: 8,
  tauNeMin: 25,
  tauCortMin: 70,
}

function fresh() {
  return { threat: 0.05, ne: 0.1, cort: 0.1, at: 0 }
}

const state = fresh()
let seen = new Set()

const clamp = (n, a, b) => Math.max(a, Math.min(b, Number.isFinite(n) ? n : a))

export const organ = {
  id: ID,
  contract: CONTRACT_VERSION,
  params,

  init(/* cfg */) {
    // 真实现：读 ~/.dsh/affect/amygdala/state.json，读坏了自愈，不抛
  },

  onHeartbeat(tx /*, ctx */) {
    // 幂等：同一 txId 只算一次
    if (seen.has(tx.txId)) return { noop: true }
    seen.add(tx.txId)
    if (seen.size > 200) seen = new Set([...seen].slice(-100))

    const dtMin = clamp(tx.dtMs / 60_000, 0, 24 * 60)
    const before = { ...state }

    state.threat = clamp(state.threat * Math.exp(-dtMin / params.tauThreatMin), 0, 1)
    state.ne = clamp(state.ne * Math.exp(-dtMin / params.tauNeMin), 0, 1)
    state.cort = clamp(state.cort * Math.exp(-dtMin / params.tauCortMin), 0, 1)
    state.at = tx.t1

    const delta = {
      threat: state.threat - before.threat,
      ne: state.ne - before.ne,
      cort: state.cort - before.cort,
    }

    return {
      delta,
      signals: [
        { name: 'sig.threat', payload: { level: state.threat } },
        { name: 'sig.tone', payload: { ne: state.ne, cort: state.cort } },
      ],
    }
  },

  onSignal(sig /*, ctx */) {
    // 示例里只处理一个信号；真实现要处理 sig.body / sig.mood / sig.recall.prior 等
    if (sig?.name === 'sig.alarm' && typeof sig.payload?.intensity === 'number') {
      const add = clamp(sig.payload.intensity * 0.3, 0, 0.3)
      state.ne = clamp(state.ne + add, 0, 1)
      return { delta: { ne: add } }
    }
    return null
  },

  read() {
    // 必须纯：不改状态、不推进时间、不产生随机数
    return { threat: state.threat, ne: state.ne, cort: state.cort }
  },

  snapshot() {
    return { threat: state.threat, ne: state.ne, cort: state.cort, at: state.at }
  },

  restore(obj) {
    if (!obj || typeof obj !== 'object') return
    state.threat = clamp(Number(obj.threat), 0, 1)
    state.ne = clamp(Number(obj.ne), 0, 1)
    state.cort = clamp(Number(obj.cort), 0, 1)
    state.at = Number(obj.at) || 0
  },

  health() {
    return { ok: true, degraded: false, reason: 'example-organ', lastTick: state.at }
  },
}

export default organ
