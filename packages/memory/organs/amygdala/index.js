// 杏仁核插件入口（单器官版）。
// 这个文件只做「挂载 + 调度 + 对外接口」，功能实现都在 lib/ 里。
// 对应功能总表：A0-1 单一入口、A5-7 定期复核、A7-6 健康检查、A8-1 接线状态。

import { every } from '../../lib/clock.js'
import { FILES, DATA_DIR, readJson, writeJsonAtomic, readJsonl, appendJsonl } from './lib/store.js'
import { makeSwitches } from './lib/switch.js'
import { makeAudit, compactAudit, health } from './lib/audit.js'
import { makeTone } from './lib/tone.js'
import { makeCapture } from './lib/capture.js'
import { makeFear } from './lib/fear.js'
import { makeGate } from './lib/gate.js'
import { makeFidelity } from './lib/fidelity.js'
import { makeReview, isReviewCandidate } from './lib/review.js'
import { makeScorer, isTestText } from './lib/score.js'
import { makeObserver } from './lib/observe.js'
import { makePorts, HIPPO_DIR } from './lib/ports.js'
import { join } from 'node:path'
import { makeReceipt } from './lib/receipt.js'
import { selfAudit } from './lib/social.js'
import { modulateOf } from './lib/modulate.js'
import { split as fidelitySplit } from './lib/fidelity.js'
import { EVENTS, V, makeEventBuffer, migrate } from './lib/contract.js'

const NAME = 'amygdala'
const VERSION = '0.1.0'
// 每次 apply 生成一个标记，用来确认「现在跑的是不是新代码」。
// 排查「热重载没换掉旧 provider」时看 stats().build 变没变。
const BUILD = `${VERSION}+${Date.now().toString(36)}`

// 不声明 inject，ctx.tools / ctx.webServer 拿不到，工具和面板会静默不注册。
// 这正是 P1-3 那条「活着但哑了」的根因。
export const inject = ['tools', 'webServer']

export function apply(ctx) {
  const switches = makeSwitches()
  const audit = makeAudit()
  const ports = makePorts(ctx)
  const receipt = makeReceipt({})

  // ── 内存态 ────────────────────────────────────────────────
  const state = {
    tone: { ne: 0, cort: 0, updatedAt: Date.now() },
    windows: [],
    openWindow: null,
    aversion: new Map(),
    safetyList: [],
    gates: new Map(),
    fidelity: new Map(),
    conflicts: [],
    reviewQueue: [],
    reviewResolved: [],
    lastSweep: 0,
    ring: [],
    samples: [],
    counters: { scored: 0, extreme: 0, threatHits: 0, conflict: 0, review: 0 },
    receipts: [],
    receiptStats: { total: 0, mismatch: 0 },
    lastVerdict: null,
    lastMood: null,
  }

  const tone = makeTone(state)
  const capture = makeCapture(state)
  const fear = makeFear(state)
  const gate = makeGate(state)
  const fidelity = makeFidelity(state)
  const review = makeReview(state)
  const scorer = makeScorer({ state, switches, audit })
  const observer = makeObserver({
    state, switches, audit, scorer, tone, capture, fear, gate, fidelity, review, ports,
  })

  // 打分器读调质和捕获（单向引用，避免循环 import）
  state.toneHook = (now) => tone.gain(now)
  state.captureHook = (id, now) => capture.factorOf(id, now)

  const runtime = {
    mounted: new Set(),
    lastTick: 0,
    lastCompact: 0,
    lastSweep: 0,
    health: null,
    lastError: null,
    startedAt: Date.now(),
  }

  // 事件去抖（P6）
  const events = makeEventBuffer((batch) => {
    for (const evt of batch) {
      try { ctx.emit?.(evt.name, evt) } catch { /* 没订阅者就算了 */ }
    }
  })

  /**
   * 从海马体的 episodes 里把 salience 捞回来，建 id → 权重 的表。
   * 为什么需要它：海马体调 salience 时 episode 还没建（没有 id），
   * 所以我这边记的分全是 id:null。前额叶拿 episodeId 来问 weight 时查不到，
   * value() 里 amy 那 0.4 权重就整块缺了——排序自然歪。
   * 海马体把分存在 episode 上了，直接读它，同步可查。
   */
  async function loadEpisodeWeights() {
    try {
      const rows = await readJsonl(join(HIPPO_DIR, 'episodes.jsonl'), { limit: 3000 })
      let n = 0
      for (const r of rows) {
        if (r?.id && Number.isFinite(Number(r.salience))) {
          state.episodeWeights.set(r.id, Number(r.salience))
          n += 1
        }
      }
      runtime.episodeWeights = n
      return n
    } catch {
      return 0
    }
  }

  // 写一条 + 发事件（订阅方可以拿去用）
  async function observeOne(event) {
    // 目标从前额叶拿（E17）。dlPFC 是"保持目标"的中心，没有它 goal 因子永远为 0
    if (!event?.goals?.length) {
      const g = ports.goals?.current?.() || []
      if (g.length) event = { ...event, goals: g }
    }
    const out = await observer.observe(event)
    if (out && !out.skipped && Number.isFinite(Number(out.score))) {
      events.push({
        name: EVENTS.scored,
        v: 1,
        at: Date.now(),
        payload: {
          id: out.id || null,
          score: out.score,
          depth: out.modulators?.depth || null,
          tags: out.tags || [],
        },
      })
    }
    return out
  }

  // ── 对外接口 ─────────────────────────────────────────────
  // 闪光灯复核的惰性入口：写入路径按批触发，最多 5 分钟一次
  let reviewLazyAt = 0
  function maybeReview() {
    if (Date.now() - reviewLazyAt < 5 * 60 * 1000) return
    reviewLazyAt = Date.now()
    try { api.reviewSweep({ limit: 20 }) } catch { /* 复核失败不影响写入 */ }
  }

  const api = {
    version: VERSION,
    v: V,

    /**
     * 打分：同步、可解释。
     * 注意：这是海马体写路径调的口，所以**必须记账**——
     * 不记 ring，重复度/新颖度永远算 0；不记 samples，标定永远冷启动；
     * 不记 audit，就查不到"这个分是谁给的"（P2-4）。
     */
    salience(input = {}) {
      const at = Date.now()
      const out = scorer.score({
        at,
        ...input,
        source: { channel: 'tool', speaker: 'self', ...(input.source || {}) },
      })
      try {
        scorer.remember(out, { text: input.text, id: input.id || null })
        audit.log('score', {
          id: input.id || null,
          via: 'salience',
          score: out.score,
          raw: out.raw,
          depth: out.modulators?.depth,
          tags: out.tags,
          degraded: out.degraded,
          source: out.source,
        })
        // 落盘也走 fire-and-forget，不阻塞海马体的写路径
        void appendJsonl(FILES.scores, {
          v: 1,
          at,
          id: input.id || null,
          via: 'salience',
          score: out.score,
          raw: out.raw,
          rank: out.rank,
          depth: out.modulators?.depth,
          tags: out.tags,
          polarity: out.polarity,
          arousal: out.arousal,
          degraded: out.degraded,
          source: out.source,
          components: out.components,
        }).catch(() => {})
      } catch { /* 记账失败不影响返回 */ }
      return out
    },

    /**
     * 标签-捕获的落库侧：把一次打分绑到具体记忆 id 上。
     * 以前 salience() 只记 text，id 恒为 null —— 8658 条分数没有一条能对到记忆，
     * 等于打了分也没人用。
     */
    bind(input = {}) {
      const id = String(input.id || '')
      if (!id) return null
      state.bound ||= Object.create(null)
      state.reviewPool ||= Object.create(null)
      const prev = state.reviewPool[id]
      const incomingConf = Number(input.confidence) || 0
      // 老记录 confidence 是 0（历史遗留）：允许用真实置信升级一次，否则永远进不了复核
      const canUpgrade = !prev || (prev.confidence || 0) === 0
      if (state.bound[id] && !(incomingConf > 0 && canUpgrade)) return { skipped: 'already-bound', id }
      state.bound[id] = Date.now()
      const at = Date.now()
      const score = Math.max(0, Math.min(1, Number(input.score) || 0))
      const row = {
        v: 1, at, id, via: 'bind', score,
        polarity: Number(input.polarity) || 0,
        arousal: Number(input.arousal) || 0,
        tags: Array.isArray(input.tags) ? input.tags : [],
        source: input.source || 'amygdala@bind',
        confidence: Number(input.confidence) || 0,
        boundAt: at,
      }
      try {
        void appendJsonl(FILES.scores, row).catch(() => {})
        audit.log('bind', { id, score: row.score, tags: row.tags })
        state.counters.bound = (state.counters.bound || 0) + 1
        state.reviewPool ||= Object.create(null)
        state.reviewPool[id] = { score: row.score, confidence: row.confidence, at }
        if (state.counters.bound % 5 === 0) maybeReview()
        saveStateSoon()
      } catch { /* 记不上不影响写入 */ }
      return row
    },

    /** 消退：更正而非删除（4.3 的对端）。强度归零但保留记录。 */
    extinguish(input = {}) {
      const subject = String(input.subject || '')
      const key = fear.keyOf(subject, input.kind || 'cue')
      const cur = state.aversion?.get?.(key)
      if (!cur) return { ok: false, why: 'no-aversion', key }
      const at = Date.now()
      state.aversion.set(key, { ...cur, strength: 0, extinguishedAt: at, reason: input.reason || '' })
      state.corrections ||= []
      state.corrections.push({ at, key, subject, reason: input.reason || '', strengthBefore: cur.strength })
      if (!Array.isArray(state.samples)) state.samples = []
      audit.log('extinguish', { key, reason: input.reason || '' })
      state.counters.extinguished = (state.counters.extinguished || 0) + 1
      saveStateSoon()
      return { ok: true, key, strengthBefore: cur.strength }
    },

    /** 闪光灯复核：高确信的记忆单独标记，定期复核（4.5）。 */
    async reviewSweep(input = {}) {
      const limit = Number(input.limit) || 20
      const now = Date.now()
      state.review ||= []
      const seen = new Set(state.review.map((r) => r.id))
      const bindRows = await readJsonl(FILES.scores)
      const cand = (bindRows || []).filter((r) => r && r.via === 'bind' && r.id && !seen.has(r.id) && isReviewCandidate(r))
      const picked = cand.slice(-limit).map((r) => ({ id: r.id, at: now, score: Number(r.score) || 0, confidence: Number(r.confidence) || 0, state: 'pending' }))
      if (picked.length) {
        state.review.push(...picked)
        state.counters.review = (state.counters.review || 0) + picked.length
        audit.log('review', { picked: picked.length })
        saveStateSoon()
      }
      return { picked: picked.length, pending: state.review.filter((r) => r.state === 'pending').length }
    },

    /** 只打分不记账（工具试算用，别污染 ring 和样本池）。 */
    dryScore(input = {}) {
      return scorer.score({
        at: Date.now(),
        ...input,
        source: { channel: 'tool', speaker: 'self', ...(input.source || {}) },
      })
    },

    /** 试打分 + 记账（给工具用）。 */
    async scoreNow(input = {}) {
      return observeOne({
        kind: 'utterance',
        at: Date.now(),
        session: input.session || 'tool',
        role: 'user',
        channel: 'tool',
        ...input,
      })
    },

    /** 慢路：只出建议，不覆盖（R13）。 */
    refine(input = {}) {
      return scorer.scoreSlow({ at: Date.now(), ...input })
    },

    /**
     * 批量打分：给前额叶做重排用（文档 3.3 多路召回）。
     * 不记账、不动 ring，只读。
     */
    scoreMany(items = []) {
      const now = Date.now()
      return items.map((it) => scorer.score({ at: now, ...it }))
    },

    /** 事件入口（单条或批量）。 */
    observe: observeOne,
    observeMany(events) {
      return observer.observeMany(events)
    },

    /** 门控：给检索方用。 */
    gate(targetId, opts = {}) {
      return {
        memory: gate.gateMemory(targetId, { now: Date.now(), ...opts }),
        expression: gate.gateExpression(targetId, { now: Date.now(), ...opts }),
        info: gate.info(targetId),
      }
    },

    /** 抑制信号：执行前额叶给的消退裁决（E6 / 文档 3.7）。渐进压，不清零。 */
    suppress(targetId, { factor = 0.7, via = 'vmPFC' } = {}) {
      const r = gate.suppress(targetId, { factor, at: Date.now() })
      tone.suppressCort(factor)
      audit.log('suppress', { targetId, factor, via, gate: r.gate })
      return { ok: true, ...r, via }
    },

    /** 恐惧查询。 */
    caution(subject, opts = {}) {
      return fear.cautionOf(subject, { now: Date.now(), ...opts })
    },

    /**
     * 这条记忆现在多重（0..1）。前额叶的 value() 拿它当 0.4 权重的一项。
     * 拿不到就返回 null —— 让前额叶判 absent，不许用 0 顶替。
     */
    weight(id) {
      const w = scorer.weightOf(id)
      return w === null ? null : { weight: Number(w.toFixed(4)), id }
    },

    /**
     * 前额叶给一个 delta，我执行（F15 的落点）。
     * 它算衰减曲线，我做加减；正数压得更狠，负数抬回来。
     */
    adjust(id, payload = {}) {
      const delta = Number(payload?.delta ?? payload?.weight ?? 0)
      const r = gate.adjust(id, delta)
      return {
        ok: true,
        id,
        weight: r.gate,
        delta: r.delta,
        weightSum: r.weightSum,
      }
    },

    /** 测试数据识别：给下游隔离用。 */
    isTest(text) {
      return isTestText(text)
    },

    /** 我这边记过的测试 id（给海马/前额叶过滤用）。 */
    testIds() {
      return [...new Set(
        state.ring.filter((r) => r.test && r.id).map((r) => r.id),
      )]
    },

    /** 当前情绪状态（前额叶的 amy.state）。 */
    state() {
      const t = tone.snapshot()
      const last = state.ring[state.ring.length - 1]
      return {
        valence: last ? Number(last.polarity || 0) : 0,
        arousal: Number(t.ne || 0),
        tone: t,
        at: Date.now(),
      }
    },

    /** 当前活跃的情绪警报（前额叶来问时一次拿全，不用一条条查）。 */
    alerts({ min = 0.3, limit = 20 } = {}) {
      const now = Date.now()
      const out = []
      for (const row of fear.list(60)) {
        if (row.kind !== 'cue') continue
        const c = fear.cautionOf(row.subject, { now })
        if (c && c.level >= min) out.push(c)
      }
      return out.sort((a, b) => b.level - a.level).slice(0, limit)
    },

    /** 被更正过的条目（前额叶做抑制时要过滤掉的那些）。 */
    corrected({ min = 0.01 } = {}) {
      const now = Date.now()
      return [...state.gates.values()]
        .filter((g) => Number(g.weightSum) > min)
        .map((g) => ({
          targetId: g.targetId,
          subject: g.subject || null,
          weightSum: Number(Number(g.weightSum).toFixed(4)),
          gate: gate.gateMemory(g.targetId, { now }),
          suppressions: g.suppressCount || 0,
          relapses: g.relapses || 0,
        }))
    },

    /** 建安全条目：消退的正确做法是新建，不是删（A3-3）。 */
    safety(subject, { kind = 'cue', byId = null } = {}) {
      const row = fear.safety(subject, { at: Date.now(), byId, kind })
      audit.log('safety', { subject, kind })
      return { ok: Boolean(row), row }
    },

    /** 失真两数：查旧条目时用，会随时间掉（A5-3）。 */
    fidelityOf(trust, vividness, ageDays = 0) {
      return fidelitySplit(trust, vividness, ageDays)
    },

    /** 复核。 */
    review: {
      list: (opts) => review.drain(opts),
      resolve: (id, opts) => review.resolve(id, opts),
      stats: () => review.stats(),
      sweep: (opts) => review.sweepReview(opts),
    },

    /** 回执对账。 */
    receipt: {
      record: (given, actual) => receipt.record(given, actual),
      stats: () => receipt.stats(),
    },

    /** 分层与亚核开关。 */
    switches,

    /** 调质快照。 */
    tone() {
      return tone.snapshot()
    },

    /** 现状：接线状态 + 分布 + 计数。 */
    async stats() {
      const h = await health()
      const sc = scorer.stats()
      const reviewStats = review.stats()
      const overTrust = selfAudit({
        scored: sc.scored,
        threatHits: sc.threatHits,
        trustAvg: 0.7,
      })
      return {
        ok: true,
        version: VERSION,
        build: BUILD,
        capabilities: ports.capabilities,
        switches: switches.list(),
        tone: tone.snapshot(),
        scoring: { ...sc, episodeWeights: state.episodeWeights.size },
        review: reviewStats,
        receipt: receipt.stats(),
        aversion: fear.list(8),
        conflicts: state.conflicts.length,
        overTrust,
        health: h,
        runtime: {
          startedAt: runtime.startedAt,
          lastTick: runtime.lastTick,
          lastError: runtime.lastError,
          mounted: runtime.mounted.size,
        },
        /** 面板第一行永远写这个（A7-6 / 防自欺） */
        effectiveOutputs: ['depth', 'days', 'rounds'],
        note: '当前只影响编码深度/保留时长/巩固轮次，不参与主排序',
      }
    },

    /** 给下游的调制量（A6）。 */
    modulators(score, opts = {}) {
      return modulateOf(score, opts)
    },

    /** 给皮层的优先写（E5）。 */
    async prioritize(item) {
      return ports.sink.prioritize(item)
    },

    /** 手动跑一次定期复核。 */
    async sweepReview(candidates = []) {
      return review.sweepReview({ candidates, force: true })
    },
  }

  // ── 工具 ──────────────────────────────────────────────────
  const tools = [
    makeTool(
      'amygdala_salience',
      '给一句话打显著性分：返回分数、分量、调制量（深度/天数/轮次）、标签和理由。只打分，不写记忆。',
      {
        text: { type: 'string' },
        session: { type: 'string' },
        goals: { type: 'array', items: { type: 'string' } },
      },
      ['text'],
      async (args) => {
        // 工具是"试算"，不记账，别污染 ring 和样本池
        const out = api.dryScore({
          text: args.text,
          session: args.session || 'tool',
          goals: args.goals || [],
        })
        return {
          ok: true,
          score: out.score,
          rank: out.rank,
          modulators: out.modulators,
          tags: out.tags,
          reasons: out.reasons,
          components: out.components,
          degraded: out.degraded,
        }
      },
    ),
    makeTool(
      'amygdala_review',
      '看/处理复核队列。action=list 看待办，resolve 处理一条（kept 保持 / downgraded 只降置信）。',
      {
        action: { type: 'string', enum: ['list', 'resolve', 'sweep'] },
        id: { type: 'string' },
        mode: { type: 'string', enum: ['kept', 'downgraded'] },
      },
      [],
      async (args) => {
        if (args.action === 'resolve') {
          const row = review.resolve(args.id, { action: args.mode || 'kept' })
          return { ok: Boolean(row), item: row }
        }
        if (args.action === 'sweep') {
          return { ok: true, ...(await review.sweepReview({ force: true })) }
        }
        return { ok: true, items: review.drain({ limit: 20 }), stats: review.stats() }
      },
    ),
    makeTool(
      'amygdala_stats',
      '看杏仁核现状：接线状态（五个口接了几个）、分布、复核、调质、过度信任自检、健康。',
      {},
      [],
      async () => api.stats(),
    ),
    makeTool(
      'amygdala_caution',
      '查某个话题/实体有没有负面关联。只提示，不拦截。',
      { subject: { type: 'string' } },
      ['subject'],
      async (args) => ({ ok: true, caution: fear.cautionOf(args.subject) || null }),
    ),
  ]

  // ── 事件订阅：从别处进来 ──────────────────────────────────
  function bindEvents() {
    const subs = []

    const on = (name, handler) => {
      try {
        const off = ctx.on?.(name, handler)
        if (typeof off === 'function') subs.push(off)
        return true
      } catch {
        return false
      }
    }

    // 海马体写入事件（E1）
    on('memory/episode/created', async (evt) => {
      try {
        const p = evt?.payload || evt?.data || {}
        if (!p.episodeId && !p.summary) return
        // 海马体只给 60 字摘要，拿不到原文就标 degraded
        const hasText = Boolean(p.text)
        const out = await observeOne({
          kind: 'episode',
          id: p.episodeId || null,
          text: p.text || p.summary || '',
          session: p.session || 'hippocampus',
          channel: 'hippocampus',
          place: p.place || '',
          at: Number(evt?.at || Date.now()),
        })
        if (!hasText) {
          runtime.lastError = null
          runtime.degradedEvents = (runtime.degradedEvents || 0) + 1
        }
        return out
      } catch (error) {
        runtime.lastError = String(error?.message || error)
      }
    })

    // Agent 收到的用户消息
    on('agent/inbox/inserted', async ({ message } = {}) => {
      try {
        const text = textOfMessage(message)
        if (!text) return
        await observeOne({
          kind: 'utterance',
          id: message?.id || null,
          text,
          session: message?.sessionId || 'agent',
          channel: 'inbox',
          speakerCount: message?.speakerCount || 0,
          at: Date.now(),
        })
      } catch (error) {
        runtime.lastError = String(error?.message || error)
      }
    })

    // QQ 这类不走 agent ctx 的会话
    on('session/event', async (session, event) => {
      try {
        if (event?.type !== 'user/message') return
        const text = textOfMessage(event?.data)
        if (!text) return
        await observeOne({
          kind: 'utterance',
          text,
          session: String(session?.id ?? 'session'),
          channel: 'session',
          at: Date.now(),
        })
      } catch (error) {
        runtime.lastError = String(error?.message || error)
      }
    })

    // 前额叶的消退裁决（E6）
    on('memory/vmpfc/suppress', async (evt) => {
      try {
        const p = evt?.payload || {}
        if (!p.episodeId) return
        api.suppress(p.episodeId, { factor: Number(p.factor || 0.7), via: 'vmPFC' })
      } catch { /* 忽略 */ }
    })

    return subs
  }

  const subs = bindEvents()
  try {
    ctx.effect?.(() => {
      for (const off of subs) {
        try { off?.() } catch { /* 忽略 */ }
      }
    })
  } catch { /* 没有 effect 就靠进程退出 */ }

  // ── 定时 ──────────────────────────────────────────────────
  function tick({ now = Date.now() } = {}) {
    try {
      runtime.lastTick = now
      tone.decay(now)
      capture.sweep(now)
      review.drain({ now, limit: 1 })

      // 跟海马体对账：episode → salience。前额叶的 weight() 靠这张表。
      if (!runtime.lastEpisodeWeights || now - runtime.lastEpisodeWeights > 5 * 60 * 1000) {
        runtime.lastEpisodeWeights = now
        void loadEpisodeWeights()
      }

      // 每 90 天定期复核
      if (!runtime.lastSweep || now - runtime.lastSweep > 90 * 24 * 60 * 60 * 1000) {
        runtime.lastSweep = now
        const candidates = []
        for (const [subject] of state.fidelity) {
          const c = fidelity.reviewCandidate(subject)
          if (c) candidates.push({ ...c, confidence: 0.6 })
        }
        void review.sweepReview({ now, candidates })
      }

      // 审计压缩：每天一次
      if (!runtime.lastCompact || now - runtime.lastCompact > 24 * 60 * 60 * 1000) {
        runtime.lastCompact = now
        void compactAudit({ now }).catch(() => {})
      }
      return { ok: true, at: now }
    } catch (error) {
      runtime.lastError = String(error?.message || error)
      return { ok: false, error: runtime.lastError }
    }
  }

  // 统一拍子：由 lib/clock.js 驱动，不再自己起 setInterval
  const stopTick = every('amygdala.tick', 5 * 60 * 1000, () => { tick() })
  try { ctx.effect?.(() => stopTick()) } catch { /* 忽略 */ }

  // ── 注册工具 ──────────────────────────────────────────────
  for (const tool of tools) {
    try {
      if (ctx.tools?.get?.(tool.name)) continue
      ctx.tools?.register?.(tool)
    } catch (error) {
      console.error(`[${NAME}] tool register failed:`, tool.name, error)
    }
  }

  // ── 面板 ──────────────────────────────────────────────────
  try {
    const ws = ctx.webServer?.register ? ctx.webServer : (ctx.get?.('webServer') ?? null)
    if (ws?.register) {
      ws.register({
        kind: 'exact',
        path: '/amygdala/state',
        handler: async (_req, res) => sendJson(res, await api.stats()),
      })
      ws.register({
        kind: 'exact',
        path: '/amygdala/score',
        handler: async (req, res) => {
          const q = new URL(req.url, 'http://x').searchParams.get('q') || ''
          sendJson(res, api.salience({ text: q }))
        },
      })
      ws.register({
        kind: 'exact',
        path: '/amygdala/review',
        handler: async (_req, res) => sendJson(res, { items: review.drain({ limit: 50 }), stats: review.stats() }),
      })
    }
  } catch { /* 没有 webServer 就当纯记忆插件 */ }

  // ── provider ──────────────────────────────────────────────
  const provider = {
    version: V,
    // 两种调法都吃：salience(text, meta) 和 salience({text, ...meta})
    salience: (text, meta = {}) => (text && typeof text === 'object'
      ? api.salience(text)
      : api.salience({ text, ...meta })),
    weight: (id) => api.weight(id),
    adjust: (id, payload) => api.adjust(id, payload),
    state: () => api.state(),
    relevance: (skeleton = {}, query = '') => ({
      // 杏仁核不参与主排序，这个口只给"该不该压/该不该提示"
      factor: 1,
      why: ['amygdala-not-a-reranker'],
      caution: skeleton.subject ? fear.cautionOf(skeleton.subject) : null,
      note: '排序权在海马体；这里只给门控和标签',
    }),
    observe: (event) => observeOne(event),
    observeMany: (events) => observer.observeMany(events),
    scoreMany: (items) => api.scoreMany(items),
    gate: (id, opts) => api.gate(id, opts),
    caution: (subject, opts) => api.caution(subject, opts),
    alerts: (opts) => api.alerts(opts),
    corrected: (opts) => api.corrected(opts),
    suppress: (id, opts) => api.suppress(id, opts),
    goals: () => ports.goals?.current?.() || [],
    safety: (subject, opts) => api.safety(subject, opts),
    isTest: (text) => api.isTest(text),
    testIds: () => api.testIds(),
    fidelitySplit: (trust, vivid, ageDays) => fidelitySplit(trust, vivid, ageDays),
    review: (id, opts) => review.resolve(id, opts),
    modulate: (score, opts) => modulateOf(score, opts),
    prioritize: (item) => ports.sink.prioritize(item),
    tone: () => tone.snapshot(),
    // 标签-捕获 / 消退 / 复核：api 上有，但 provider 是白名单，以前没暴露出去。
    // 海马体拿到的是 provider，所以 typeof svc.bind === 'undefined'，绑定静默跳过。
    bind: (input) => api.bind(input),
    extinguish: (input) => api.extinguish(input),
    reviewSweep: (input) => api.reviewSweep(input),
    stats: () => api.stats(),
    switches,
  }
  try { ctx.provide?.('memory.amygdala', provider) } catch { /* 老版本没有 provide */ }
  try { ctx.set?.('memory.amygdala', provider) } catch { /* 同上 */ }

  // ── 启动加载 ──────────────────────────────────────────────
  void (async () => {
    try {
      const raw = await readJson(FILES.state, null)
      const saved = raw ? migrate(raw) : null
      if (saved?.tone) {
        state.tone = { ...state.tone, ...saved.tone }
        state.tone.updatedAt = Number(saved.tone.updatedAt || Date.now())
      }
      if (saved?.counters) state.counters = { ...state.counters, ...saved.counters }
      if (saved?.samples) state.samples = saved.samples.slice(-200)
      if (saved?.lastSweep) state.lastSweep = Number(saved.lastSweep)

      // 恢复 aversion / gates（只读回内存，不写）
      const aversionRows = await readJsonl(FILES.aversion, { limit: 500 })
      for (const row of aversionRows) {
        if (row?.key) state.aversion.set(row.key, row)
      }
      const gateRows = await readJsonl(FILES.corrections, { limit: 500 })
      for (const row of gateRows) {
        if (row?.targetId) {
          const cur = state.gates.get(row.targetId) || {
            v: 1, targetId: row.targetId, weightSum: 0, relapses: 0, lastRelapseAt: 0, lastSession: null, lastScore: 1,
          }
          cur.weightSum = Math.min(0.95, cur.weightSum + Number(row.weight || 0))
          state.gates.set(row.targetId, cur)
        }
      }

      runtime.health = await health()
      // 先把海马体的分捞回来，weight() 一上来就能查
      await loadEpisodeWeights()
      try { api.reviewSweep({ limit: 50 }) } catch { /* 复核失败不影响启动 */ }
      audit.log('boot', { version: VERSION, dir: DATA_DIR, episodeWeights: state.episodeWeights.size })
    } catch (error) {
      runtime.lastError = String(error?.message || error)
    }
  })()

  // 落盘：一次 + 定时 + 按需（原来是"只写一次"的 IIFE，counters 永远停在 0）
  // 每次落盘前用磁盘重算计数：多进程写同一目录时，内存计数器不可信
  // 落盘前先和磁盘合并：线上发现复核队列"挑中 50 条、落盘后变 0"。
  // 原因是可能有第二个实例持有同一份 state 并回写（后写覆盖前写）。
  // 这里按"并集"合并：review 按 id 并、reviewPool 按 key 并、counters 取大，谁都不会丢。
  const mergeWithDisk = async () => {
    try {
      const raw = await readJsonl(FILES.scores) // 顺带确保数据目录可读
      void raw
      const fs = await import('node:fs')
      const p = FILES.state
      if (!p || !fs.existsSync(p)) return
      const disk = JSON.parse(fs.readFileSync(p, 'utf8'))
      if (!disk || typeof disk !== 'object') return
      if (Array.isArray(disk.review) && disk.review.length) {
        state.review ||= []
        const seen = new Set(state.review.map((r) => r.id))
        for (const r of disk.review) if (r?.id && !seen.has(r.id)) state.review.push(r)
      }
      if (disk.reviewPool && typeof disk.reviewPool === 'object') {
        state.reviewPool ||= Object.create(null)
        for (const [k, v] of Object.entries(disk.reviewPool)) if (!state.reviewPool[k]) state.reviewPool[k] = v
      }
      for (const [k, v] of Object.entries(disk.counters || {})) {
        const n = Number(v)
        if (Number.isFinite(n) && n > (Number(state.counters?.[k]) || 0)) state.counters[k] = n
      }
    } catch { /* 合并失败就按内存写，不能因此不落盘 */ }
  }

  const countersFromDisk = async () => {
    try {
      const rows = await readJsonl(FILES.scores)
      const n = (k) => rows.filter((r) => r && r.via === k).length
      state.counters.scored = rows.filter((r) => r && r.via === 'salience').length
      state.counters.bound = n('bind')
      state.counters.extreme = rows.filter((r) => r && (r.tags || []).includes('extreme')).length
      state.counters.review = (state.review || []).length
    } catch { /* 读不到就保留内存值 */ }
  }

  const saveState = async () => {
    try {
      await countersFromDisk()
      await mergeWithDisk()
      await writeJsonAtomic(FILES.state, {
        v: 1,
        tone: state.tone,
        counters: state.counters,
        samples: (state.samples || []).slice(-200),
        lastSweep: state.lastSweep,
        corrections: (state.corrections || []).slice(-100),
        review: (state.review || []).slice(-100),
        reviewPool: state.reviewPool || {},
      })
    } catch { /* 写不进去下次再来 */ }
  }
  let saveTimer = null
  const saveStateSoon = () => {
    if (saveTimer) return
    saveTimer = setTimeout(() => { saveTimer = null; void saveState() }, 800)
    if (typeof saveTimer.unref === 'function') saveTimer.unref()
  }
  void saveState()
  const stateTick = setInterval(() => { void saveState() }, 60 * 1000)
  if (typeof stateTick.unref === 'function') stateTick.unref()

  return () => { /* 卸载时定时器由 effect 清掉 */ }
}

function makeTool(name, description, properties, required, handler) {
  return {
    name,
    description,
    parameters: {
      type: 'object',
      properties,
      required,
      additionalProperties: false,
    },
    output: {
      schema: { type: 'object' },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
    },
    isConcurrencySafe: () => false,
    async execute(args, exec) {
      const out = await handler(args || {}, exec || {})
      return { content: [{ type: 'text', text: JSON.stringify(out ?? {}, null, 2) }] }
    },
  }
}

function textOfMessage(message) {
  if (!message) return ''
  if (typeof message === 'string') return message
  if (typeof message.text === 'string') return message.text
  if (typeof message.content === 'string') return message.content
  if (Array.isArray(message.content)) {
    return message.content
      .filter((c) => c?.type === 'text' && typeof c.text === 'string')
      .map((c) => c.text)
      .join(' ')
  }
  return ''
}

function sendJson(res, value) {
  try {
    res.statusCode = 200
    res.setHeader?.('content-type', 'application/json; charset=utf-8')
    res.end?.(JSON.stringify(value))
  } catch { /* 面板出错不炸插件 */ }
}
