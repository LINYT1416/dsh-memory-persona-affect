// 假总控：给单个器官做契约测试用。
// 它实现真 core 的骨架语义：单一时钟、一次事务、两轮信号、delta 合并、纯度检查。
// 真 core 会多出落盘、journal、降级矩阵、熔断；但器官在假总控上能过，接真 core 只差 IO。

import {
  CONTRACT_VERSION, ORGANS, SIGNALS, validateOrgan, validateSignal,
  makeTx, makeRng, findNonFinite,
} from './contract.mjs'

/** delta 合并语义：数字相加、数组拼接、对象递归、其余覆盖 */
export function mergeDelta(target, delta) {
  if (!delta || typeof delta !== 'object') return target
  for (const [k, v] of Object.entries(delta)) {
    if (typeof v === 'number' && typeof target[k] === 'number') target[k] += v
    else if (Array.isArray(v) && Array.isArray(target[k])) target[k] = [...target[k], ...v]
    else if (v && typeof v === 'object' && !Array.isArray(v) && target[k] && typeof target[k] === 'object' && !Array.isArray(target[k])) {
      target[k] = mergeDelta({ ...target[k] }, v)
    } else target[k] = v
  }
  return target
}

/**
 * 创建测试用总控
 * @param {object} organ 待测器官
 * @param {{cfg?:object, seed?:number, maxRounds?:number}} opts
 */
export function createHarness(organ, { cfg = {}, seed = 20261110, maxRounds = 2 } = {}) {
  const trace = []
  const state = {}
  const problems = []
  const inbox = []
  let tick = 0
  let t = Date.now()

  const emit = (sig) => {
    const name = sig?.name
    const payload = sig?.payload ?? {}
    const check = validateSignal(name, payload, { strict: false })
    if (!check.ok) problems.push(`信号非法: ${check.errors.join('; ')}`)
    if (check.warn) problems.push(`信号未登记: ${name}`)
    inbox.push({ name, payload })
  }

  const runTick = ({ t0 = t, t1 = t0 + 1000, events = [] } = {}) => {
    tick += 1
    t = t1
    const txId = `tx_${tick}`
    const tx = makeTx({ txId, t0, t1, seed: seed + tick, events })
    const entry = { txId, t0, t1, dtMs: tx.dtMs, rounds: [], signals: [], deltas: [] }

    let out
    try {
      out = organ.onHeartbeat(tx, { rng: makeRng(seed, organ.id, tick), emit })
    } catch (e) {
      problems.push(`onHeartbeat 抛错: ${e?.message || e}`)
      return entry
    }
    entry.rounds.push(1)
    const applied = normalizeReturn(out)
    if (applied) {
      mergeDelta(state, applied.delta)
      entry.deltas.push(applied.delta || {})
      for (const s of applied.signals) emit(s)
    }

    // 两轮投递上限
    for (let round = 2; round <= maxRounds; round++) {
      if (!inbox.length) break
      const batch = inbox.splice(0, inbox.length)
      entry.rounds.push(round)
      for (const sig of batch) {
        let r
        try {
          r = organ.onSignal(sig, { rng: makeRng(seed, organ.id, tick + round) })
        } catch (e) {
          problems.push(`onSignal(${sig.name}) 抛错: ${e?.message || e}`)
          continue
        }
        const a = normalizeReturn(r)
        if (a) {
          mergeDelta(state, a.delta)
          entry.deltas.push(a.delta || {})
          for (const s of a.signals) emit(s)
        }
      }
    }
    // 第二轮之后丢弃剩余，交给下一 tick
    entry.signals = [...inbox]
    inbox.length = 0

    const bad = findNonFinite(state)
    if (bad.length) problems.push(`状态出现非有限数: ${bad.slice(0, 5).join(', ')}`)
    trace.push(entry)
    return entry
  }

  return {
    organ,
    state,
    trace,
    problems,
    get tick() { return tick },
    init() { try { organ.init(cfg) } catch (e) { problems.push(`init 抛错: ${e?.message || e}`) } },
    runTick,
    runSteps(n = 3, stepMs = 60_000) {
      for (let i = 0; i < n; i++) runTick({ t0: t, t1: t + stepMs })
    },
    validate: () => validateOrgan(organ),
    info: () => ORGANS[organ.id] || null,
  }
}

/** 统一 onHeartbeat/onSignal 的返回：{delta, signals} 或裸 delta */
function normalizeReturn(out) {
  if (!out || typeof out !== 'object') return null
  const signals = Array.isArray(out.signals) ? out.signals : []
  const delta = out.delta && typeof out.delta === 'object' ? out.delta : (out.delta === undefined ? pickBare(out) : {})
  return { delta, signals }
}

function pickBare(out) {
  const { signals, noop, ...rest } = out
  return rest
}

export { CONTRACT_VERSION, SIGNALS }
