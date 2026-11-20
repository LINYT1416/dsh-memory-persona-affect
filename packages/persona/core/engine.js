// 心情式合并：一个 world、一个时钟、一个顺序。
// 学 dsh-affect 的 engine：cache 每帧清、lastKnown 留上一帧、单模块回滚、单飞锁、幂等。
// 六个器官同帧同序，三条总线（价值/冲突/自我）就成立；拆成外壳会慢一帧，慢一帧就是排队。

import { clamp, decay, features, cueOf, hash } from './consts.js'
import { biasOf } from './bias.js'
import { plasticity, touch, addShock, decayShock, blankMeta } from './quench.js'
import { createSignatures } from './signature.js'
import { createTracker } from './traitstat.js'

import { create as str } from '../organs/str.js'
import { create as tpj } from '../organs/tpj.js'
import { create as ofc } from '../organs/ofc.js'
import { create as acc } from '../organs/acc.js'
import { create as mpfc } from '../organs/mpfc.js'
import { create as pcc } from '../organs/pcc.js'

// A 段先跑习惯匹配；B 段按信号流走：读人 → 定价 → 检错 → 归我 → 连故事 → 固化
export const ORDER_A = ['str']
export const ORDER_B = ['tpj', 'ofc', 'acc', 'mpfc', 'pcc', 'str']

const DEFAULTS = {
  str: { primed: 0, wanting: 0, ritual: 0, broken: 0, top: [] },
  tpj: { intent: 0.5, offense: 0, air: 0.5, blunt: 0.3, misread: 0, role: 'close' },
  ofc: { value: 0.5, intent: 0.5, warm: 0, guilt: 0, shame: 0, unfair: 0, risk: 0.5, face: 0, spread: 0 },
  acc: { conflict: 0, error: 0, adjusting: 0, sticky: 0.55, effort: 0.3, reallocate: false },
  mpfc: { relevance: 0.3, esteem: 0.5, boundary: 0.5, protecting: 0, calm: 0, poked: 0 },
  pcc: { nostalgia: 0, continuity: 0.6, chapter: '', anchors: [], anchorCount: 0 },
}

// 慢层只动这四个，每个都有明确的证据来源。其余不许动——白纸就白在"没证据不改"。
const SPECS = [
  { id: 'acc.stickiness', organ: 'acc', key: 'stickiness', domain: [0.2, 0.9], neutral: 0.55, from: 'error', sign: -1 },
  { id: 'ofc.shameBase', organ: 'ofc', key: 'shameBase', domain: [0.05, 0.6], neutral: 0.25, from: 'cold', sign: 1 },
  { id: 'mpfc.protectGain', organ: 'mpfc', key: 'protectGain', domain: [0.2, 0.9], neutral: 0.55, from: 'protect', sign: 1 },
  { id: 'str.habitGain', organ: 'str', key: 'habitGain', domain: [0.1, 0.7], neutral: 0.35, from: 'repeat', sign: 1 },
]

export const TICK_MS = 60_000
export const SLOW_MS = 24 * 3_600_000

let userBias = null

export function createEngine({ config = {}, bridge = null, emit = null, now = () => Date.now() } = {}) {
  const organs = {
    str: str(config.str),
    tpj: tpj(config.tpj),
    ofc: ofc(config.ofc),
    acc: acc(config.acc),
    mpfc: mpfc(config.mpfc),
    pcc: pcc(config.pcc),
  }

  // if-then 签名：白纸时全 0，只靠重复长出来
  const sigs = createSignatures(config.signature)
  // 跨时间统计：瞬时值给"此刻"，均值给"这个人"
  const tracker = createTracker(config.tracker)

  const state = {
    at: now(),
    ticks: 0,
    lastText: '',
    relationship: config.relationship || 'close',
    evidence: [],
    meta: {},
    lastSlow: 0,
    mood: 0,
    inherited: null,
  }
  for (const spec of SPECS) state.meta[spec.id] = blankMeta(spec.neutral)

  const cache = new Map()
  const lastKnown = new Map()
  const seen = new Map()
  const trace = []
  let fused = null
  let busy = false

  const world = {
    tx: null,
    get(id) { return cache.get(id) ?? lastKnown.get(id) ?? DEFAULTS[id] ?? null },
    episodes: [],
    affect: null,
    relationship: 'close',
    memory: null,
    stable: {},   // 上一帧的跨时间统计，给后扣带算"像不像自己"
  }

  function readAll() {
    const out = {}
    for (const id of Object.keys(organs)) out[id] = world.get(id) || DEFAULTS[id] || {}
    return out
  }

  function stepOne(id, isFast = false) {
    const m = organs[id]
    if (!m) return
    const before = m.snapshot()
    try {
      if (isFast) {
        if (typeof m.fast === 'function') m.fast(world)
        else return
      } else {
        m.step(world)
      }
      const r = m.read()
      cache.set(id, r)
      lastKnown.set(id, r)
    } catch (e) {
      // 只回滚抛错的那个，别的照跑
      try { m.restore(before) } catch { /* 回滚失败也不能连累别人 */ }
      trace.push({ error: id, msg: String(e?.message || e) })
      if (trace.length > 200) trace.shift()
    }
  }

  function fuse(at) {
    const r = readAll()
    const hex = {
      brevity: clamp(0.3 + 0.4 * r.acc.conflict + 0.35 * r.mpfc.protecting + 0.2 * r.tpj.offense - 0.25 * r.tpj.air, 0.05, 1),
      warmth: clamp(0.5 + 0.3 * r.ofc.warm - 0.3 * r.ofc.shame + 0.2 * r.tpj.air - 0.25 * r.tpj.offense, 0, 1),
      delayMs: Math.round(clamp(3000 * (1 + 1.5 * r.acc.conflict + 1.2 * r.mpfc.protecting), 0, 360_000)),
      meme: clamp(0.55 + 0.3 * r.ofc.warm - 0.4 * (r.ofc.shame + r.ofc.guilt), 0.05, 1),
      blunt: clamp(r.tpj.blunt, 0, 1),
    }
    // B 层：进不了字面的读数走偏置，改语气/长短/延迟/表情包，不显字
    const bias = biasOf(r)
    const ub = userBias || {}
    hex.brevity = clamp(hex.brevity + bias.brevity + (Number(ub.brevity) || 0), 0.05, 1)
    hex.warmth = clamp(hex.warmth + bias.warmth + (Number(ub.warmth) || 0), 0, 1)
    hex.blunt = clamp(hex.blunt + bias.blunt + (Number(ub.blunt) || 0), 0, 1)
    hex.meme = clamp(hex.meme + bias.meme, 0.05, 1)
    hex.delayMs = Math.round(clamp(hex.delayMs + bias.delayMs + (Number(ub.delayMs) || 0), 0, 360_000))

    const traits = {
      habitStrength: r.str.primed,
      wanting: r.str.wanting,
      stickiness: r.acc.sticky,
      selfFocus: r.mpfc.relevance,
      esteem: r.mpfc.esteem,
      boundary: r.mpfc.boundary,
      nostalgia: r.pcc.nostalgia,
      continuity: r.pcc.continuity,
      face: r.ofc.face,
      misread: r.tpj.misread,
    }
    return { at, reads: r, hex, traits }
  }

  /** 慢层：一天最多一次。只动 SPECS 里那四个，有证据才动，没证据不动 */
  function slow(at) {
    const ev = state.evidence
    state.lastSlow = at
    if (ev.length < 20) return { skipped: 'not-enough', n: ev.length }

    const avg = (k) => ev.reduce((s, e) => s + (Number(e[k]) || 0), 0) / ev.length
    const evidence = { error: avg('error'), cold: avg('cold'), protect: avg('protect'), repeat: avg('repeat') }

    const moved = []
    for (const spec of SPECS) {
      const meta = state.meta[spec.id]
      const base = evidence[spec.from] ?? 0
      if (base <= 0.05) continue
      const plast = plasticity(meta)
      const span = spec.domain[1] - spec.domain[0]
      const want = spec.neutral + spec.sign * (base - 0.05) * span * 0.5
      const raw = (want - meta.value) * plast * 0.3
      const cap = span * 0.02
      const d = clamp(raw, -cap, cap)
      if (Math.abs(d) < span * 1e-4) continue
      const organ = organs[spec.organ]
      organ.params[spec.key] = clamp(meta.value + d, spec.domain[0], spec.domain[1])
      meta.value = organ.params[spec.key]
      meta.source = 'learned'
      touch(meta)
      decayShock(meta, SLOW_MS)
      moved.push({ id: spec.id, to: Number(meta.value.toFixed(4)), from: evidence[spec.from] })
    }
    state.evidence = []
    return { moved, n: ev.length }
  }

  function tick(events = [], sessionId = '') {
    if (busy) return fused
    busy = true
    try {
      const t1 = now()
      const dtMs = clamp(t1 - state.at, 0, 24 * 3_600_000)

      // 幂等：同一条内容 30 秒内不重复计
      const uniq = []
      for (const e of events) {
        const key = `${e.type}:${hash(String(e.text || ''))}`
        const last = seen.get(key) || 0
        if (t1 - last < 30_000) continue
        seen.set(key, t1)
        uniq.push(e)
      }
      if (seen.size > 200) seen.clear()

      const lastUser = uniq.filter((e) => e.type === 'user').slice(-1)[0]
      const text = lastUser ? String(lastUser.text) : state.lastText
      if (lastUser) state.lastText = String(text).slice(0, 200)

      const tx = {
        txId: `tx_${state.ticks + 1}`,
        t0: state.at, t1, dtMs,
        events: uniq, text,
        f: features(text),
        cue: cueOf(text),
        session: sessionId,
        // A12 要靠这一拍是"谁在说"来判断"改口"；以前没有 role，条件恒 false
        role: uniq.some(x => x.type === 'assistant') && !lastUser ? 'assistant' : 'user',
      }

      cache.clear()
      world.tx = tx
      world.relationship = state.relationship

      // 读外面的两个器官（拿不到就是 null，不伪造）
      if (bridge) {
        try { world.affect = bridge.affect() } catch { world.affect = null }
        try { world.episodes = bridge.episodes ? bridge.episodes() : [] } catch { world.episodes = [] }
      }

      // 后扣带要用"上一帧的统计"来算像不像自己，不能用它自己这一帧
      world.stable = tracker.all()

      // K1：没有真人说话的这一拍是「快拍」——只动习惯层，慢器官（价值/自我/叙事/读人）不推进。
      // 以前两条 ORDER 无条件都跑，导致每次轮询都在偷偷把她往前推。
      // 只有「什么都没发生」才是快拍；带事件的一拍（哪怕没标 type）都算真回合。
      // 快拍 = 这一拍根本没收到事件。注意不能用去重后的 uniq：重复同一句话会被去重成空，
      // 但那仍然是真回合，慢器官要推进（习惯固化/腻掉都靠这个）。
      const fastBeat = !Array.isArray(events) || events.length === 0
      for (const id of ORDER_A) stepOne(id, true)
      if (!fastBeat) for (const id of ORDER_B) stepOne(id, false)

      const raw = fuse(t1)

      // if-then：先学（看这一拍有没有偏），再用（长出来的才改输出，白纸不改）
      sigs.learn(tx.f, raw.hex)
      const sigHex = sigs.apply(raw.hex, tx.f)

      // 跨时间统计：推瞬时，取均值。瞬时给此刻，均值给这个人
      for (const [k, v] of Object.entries(raw.traits)) tracker.push(k, v)
      const smooth = {}
      for (const k of Object.keys(raw.traits)) smooth[k] = Number((tracker.get(k) ?? raw.traits[k]).toFixed(4))

      fused = {
        ...raw,
        hex: sigHex,
        traits: smooth,
        rawTraits: raw.traits,
        stable: tracker.all(),
        signatures: sigs.strongest(),
      }
      state.at = t1
      state.ticks += 1

      // 攒证据，给慢层用
      state.evidence.push({
        at: t1,
        error: fused.reads.acc.error,
        cold: tx.f.cold,
        protect: tx.f.cold && tx.f.otherRef ? 1 : 0,
        repeat: fused.reads.str.primed,
        conflict: fused.reads.acc.conflict,
      })
      if (state.evidence.length > 800) state.evidence.shift()

      if (t1 - state.lastSlow >= SLOW_MS) {
        try { fused.slow = slow(t1) } catch (e) { trace.push({ error: 'slow', msg: String(e?.message || e) }) }
      }

      if (emit && fused) {
        try { emit('persona.tick', { at: t1, hex: fused.hex }) } catch { /* 没人听 */ }
      }
      return fused
    } catch (e) {
      trace.push({ error: 'tick', msg: String(e?.message || e) })
      return fused
    } finally {
      busy = false
    }
  }

  return {
    organs,
    state,
    world,
    order: { a: ORDER_A, b: ORDER_B },
    paramsOf: (id) => organs[id]?.params || null,
    tick,
    slow: () => slow(now()),
    read: () => fused,
    trace: () => trace.slice(-20),
    snapshot() {
      return {
        schema: 2,
        at: state.at,
        ticks: state.ticks,
        lastText: state.lastText,
        relationship: state.relationship,
        meta: JSON.parse(JSON.stringify(state.meta)),
        evidence: state.evidence.slice(-200),
        lastSlow: state.lastSlow,
        signatures: sigs.snapshot(),
        tracker: tracker.snapshot(),
        organs: Object.fromEntries(Object.entries(organs).map(([k, m]) => [k, m.snapshot()])),
      }
    },
    restore(saved) {
      if (!saved || saved.schema !== 2) return false
      state.at = Number(saved.at) || state.at
      state.ticks = Number(saved.ticks) || 0
      state.lastText = saved.lastText || ''
      state.relationship = saved.relationship || 'close'
      state.lastSlow = Number(saved.lastSlow) || 0
      if (saved.meta) state.meta = { ...state.meta, ...saved.meta }
      state.evidence = Array.isArray(saved.evidence) ? saved.evidence : []
      for (const [k, v] of Object.entries(saved.organs || {})) {
        try { organs[k]?.restore(v) } catch { /* 单个器官恢复失败不拖累别的 */ }
      }
      try { sigs.restore(saved.signatures) } catch { /* 签名丢了就重新长 */ }
      try { tracker.restore(saved.tracker) } catch { /* 统计丢了就重新攒 */ }
      return true
    },
    health() {
      return {
        at: state.at,
        ticks: state.ticks,
        organs: Object.fromEntries(Object.entries(organs).map(([k, m]) => [k, m.health()])),
        trace: trace.slice(-5),
        evidence: state.evidence.length,
        lastSlow: state.lastSlow,
        signatures: sigs.strongest(5),
        signatureCount: sigs.activeCount(),
        stability: tracker.stability(),
      }
    },
    reset() {
      state.evidence = []
      for (const spec of SPECS) state.meta[spec.id] = blankMeta(spec.neutral)
    },
  }
}


// 人设偏置：由 index 在自述变化时写入，下一拍 hex 就带上
export function setUserBias(b) { userBias = (b && typeof b === 'object') ? b : null }
export function getUserBias() { return userBias }
