import fs from 'node:fs'
// 海马体插件入口（单器官版）。
// 这个文件只做“挂载 + 调度 + 对外接口”，功能实现都在 lib/ 里。
// 对应功能总表：L0-6 上下文供给、L4-6 时机窗口、L4-7 两种巩固、L5-6 分层开关、E13 注入内容。

import { every, dailyAt } from '../../lib/clock.js'
import { readFileSync } from 'node:fs'
import { HippoStore, OWNER } from './lib/memory.js'
import { makeEncoder } from './lib/encode.js'
import { makeRecall } from './lib/recall.js'
import { pickProactive, proactiveLine } from './lib/proactive.js'
import { makeConsolidator, shouldRunNow } from './lib/consolidate.js'
import { forecast } from './lib/forecast.js'
import { pullFromCache, recentCacheFiles, loadCursors, saveCursors } from './lib/session-cache.js'
import { EVENTS, makeEventBuffer, dedupeKey } from './lib/contract.js'
import { makeOrgans } from './lib/adapters.js'
import { makeLayerSwitch, sweepOnce } from './lib/decay.js'
import { readMeta, writeMeta, appendLinks, readJsonl, appendJsonl, FILES } from './lib/store.js'
import { appendFileSync, mkdirSync as mkdirSyncFs, statSync as statSyncFs, writeFileSync as writeFileSyncFs } from 'node:fs'
import { healthCheck, enforceCapacity, messageDensity, detectDangling, rebuildFromRaw, recentRaw } from './lib/maintenance.js'
import { flushVectors } from './lib/vectors.js'
import { isStorable, textOf } from './lib/util.js'

const NAME = 'hippocampus'
const VERSION = '0.1.0'

// 不声明 inject，ctx.webServer / ctx.tools 拿不到，面板和工具会静默不注册。
/**
 * 钩子心跳：每次事件命中写一行（上限 200 行，滚动覆盖）。
 * 目的只有一个——分清"宿主没发事件"和"发了但我们没认出来"。
 * 没有这行日志时，之前十几轮全靠猜。
 */
function hookBeat(hook, extra = {}) {
  try {
    const dir = process.env.HIPPOCAMPUS_DIR || 'C:/Users/64091/.dsh/hippocampus'
    mkdirSyncFs(dir, { recursive: true })
    const file = dir + '/_hook.log'
    appendFileSync(file, JSON.stringify({ at: Date.now(), hook, ...extra }) + '\n')
    if (statSyncFs(file).size > 256 * 1024) writeFileSyncFs(file, '')
  } catch (e) {
    // 心跳自己坏了要能被看见，不能再静默
    try { writeFileSyncFs('C:/Users/64091/.dsh/hippocampus/_hook.err', String(e?.message || e) + '\n') } catch {}
  }
}

// 少了 'sessions'：session/event 由 Session 服务派发，没声明就没资格接。
// 这是之前钩子一直不触发的真正原因（image-offload 插件也是 agents+sessions 才接得到）。
hookBeat('boot', { stage: 'module-top' })
export const inject = ['tools', 'webServer', 'agents', 'sessions']

function pickTextAny(v) {
  if (v == null) return ''
  if (typeof v === 'string') return v
  if (Array.isArray(v)) return v.map(pickTextAny).filter(Boolean).join('')
  if (typeof v === 'object') return pickTextAny(v.text ?? v.content ?? v.message?.text ?? v.parts)
  return ''
}

export function apply(ctx) {
  // 启动后把存量记忆的 salience/confidence 全部绑给杏仁核（标签-捕获的存量补齐）。
  // 放在 apply 里做，延迟 3 秒等 store 就绪；幂等由 sdk 侧去重 + 升级规则保证。
  function bindAllEpisodes() {
    try {
      const amy = ctx.get?.('memory.amygdala')
      if (!amy || typeof amy.bind !== 'function') return 0
      let n = 0
      for (const ep of (store.allEpisodes ? store.allEpisodes() : [])) {
        if (!ep?.id) continue
        const r = amy.bind({ id: ep.id, score: Number(ep.salience) || 0, confidence: Number(ep.confidence) || 0, tags: ep.tags || [], source: { channel: 'boot' } })
        if (r && !r.skipped) n += 1
      }
      return n
    } catch { return 0 }
  }
  setTimeout(() => { try { bindAllEpisodes() } catch { /* 静默 */ } }, 3000)

  try {
    hookBeat('apply-start', { hasAgents: !!ctx.agents, hasSessions: !!ctx.get?.('sessions'), hasTools: !!ctx.tools })
  } catch (error) {
    hookBeat('apply-start-failed', { error: String(error?.message || error) })
  }
  const layers = makeLayerSwitch()
  const store = new HippoStore()
  // 器官探测：每次用到现探，不再靠定时器。
  // 插件加载顺序不定——谁先谁后都行，第一次用到谁就顺手把三个都探一遍。
  const organs = makeOrgans(ctx)
  let lastProbeAt = 0
  function ensureOrgan(name) {
    if (organs[name]) return organs[name]
    const now = Date.now()
    if (now - lastProbeAt < 500) return organs[name] // 500ms 节流，别一条消息探三次
    lastProbeAt = now
    try {
      const fresh = makeOrgans(ctx)
      for (const key of ['cortex', 'amygdala', 'prefrontal']) {
        if (fresh[key] && !organs[key]) organs[key] = fresh[key]
      }
      organs.capabilities = fresh.capabilities
    } catch { /* 下一轮再探 */ }
    return organs[name]
  }
  const adapters = {
    get cortex() { return ensureOrgan('cortex') },
    get amygdala() { return ensureOrgan('amygdala') },
    get prefrontal() { return ensureOrgan('prefrontal') },
    get capabilities() {
      // 读能力时也补探一次：stats 一调就是真实值，不是启动那一刻的快照
      ensureOrgan('cortex')
      ensureOrgan('amygdala')
      ensureOrgan('prefrontal')
      return organs.capabilities
    },
  }
  const encoder = makeEncoder({ store, adapters })
  const recaller = makeRecall({ store, adapters })
  const consolidator = makeConsolidator({ store, adapters, layers })

  const runtime = {
    mounted: new Set(),
    lastInject: 0,
    lastConsolidate: 0,
    lastCapacityAt: 0,
    health: null,
    lastError: null,
    contextCache: new Map(),
    vecReady: false,
    traceStats: null,
    traceStatsAt: 0,
  }

  // R20：事件去抖
  const events = makeEventBuffer((batch) => {
    for (const evt of batch) {
      try { ctx.emit?.(evt.name, evt) } catch { /* 没有订阅者就算了 */ }
    }
  })

  // ── 注入：只给索引摘要，不整段灌（L0-6 / E13）─────────────────
  function composeContext(sessionId) {
    // 情绪写回的条目（【情绪】… / type=emotion）不进"最近记得的事"：
    // 它本来是给心情通路用的，混进日常记忆注入里就成噪音——
    // 人不会把"我刚才有点委屈"当成一件发生过的事讲给下一个人听。
    // recall 默认也排除它们，这里以前没排，两边不一致。
    const isEmotionEp = (e) => e?.type === 'emotion' || String(e?.summary || '').startsWith('【情绪】')
    // 先看本会话；本会话一条都没有（新窗口）就回退到"这个人"的最近记忆，
    // 这样换个窗口也接得上，不至于变成另一个人。
    let eps = store.sessionEpisodes(sessionId).filter((e) => !isEmotionEp(e)).slice(-5)
    let 跨窗口 = false
    if (!eps.length) {
      eps = store.ownerEpisodes(OWNER, 5).filter((e) => !isEmotionEp(e))
      跨窗口 = eps.length > 0
    }
    if (!eps.length) return ''
    const lines = eps.map((ep) => {
      const t = new Date(ep.start)
      const hm = `${String(t.getHours()).padStart(2, '0')}:${String(t.getMinutes()).padStart(2, '0')}`
      const day = t.toDateString() === new Date().toDateString() ? '今天' : `${t.getMonth() + 1}/${t.getDate()}`
      return `- ${day} ${hm} ${ep.summary}`
    })
    const 标题 = 跨窗口 ? '【海马体·最近记得的事（跨对话）】' : '【海马体·最近记得的事】'
    return [标题, ...lines, '（这是索引，不是全文；细节想不起来就说想不起来，别编。）'].join('\n')
  }

  function refreshContext(sessionId) {
    runtime.contextCache.set(sessionId, composeContext(sessionId))
  }

  // ── 写入口：所有消息都从这里进（C1 单一入口）───────────────────
  async function write(input) {
    if (layers.isOff('encode')) return { skipped: 'layer-off' }
    // force：结构化写入（心情的情绪条目等）不该走"这是不是人话"的过滤器。
    // 以前这里无视 force，而 isStorable 只认 role=user/assistant——
    // 心情传的是 kind:'affect'，于是每一条情绪写回都被判成 noise 丢掉，
    // 账本上却记着"写回成功"。177 条账本对 34 条 episode 就是这么来的。
    // assistant-summary：我说的话只留一句短摘要，不然会挤满"她说过的"名额，
    // 回声以后还会拿我的技术解释冒充"以前"。她的原话照原样存。
    if (input && input.role === 'assistant' && typeof input.text === 'string' && input.text.length > 40) {
      const flat = input.text.split('```').join(' ').replace(/\s+/g, ' ').trim()
      const cut = flat.slice(0, 40).replace(/[，。；、,.;:]$/, '')
      input = { ...input, text: '（我说的）' + cut + '…' }
    }
    // 任何人写进来的 text 都先归成字符串：以前对象被 String() 成 [object Object] 落了库
    if (input && typeof input.text !== 'string') {
      const normalized = pickTextAny(input.text)
      input = { ...input, text: normalized }
      if (!normalized) return { skipped: 'empty-text' }
    }
    // 宿主每轮都会注入一大段说明（运行上下文/抽屉卡），那不是她说的���，不写进记忆
    if (input && typeof input.text === 'string' && /Current runtime context|【这个抽屉|【小鱼的生活|背景，别在回复里提到这段说明/.test(input.text)) {
      return { skipped: 'runtime-block' }
    }
    if (!input?.force && !isStorable(input.role, input.text)) return { skipped: 'noise' }
    const out = await encoder.ingest(input)
    refreshContext(input.session)
    // 写路径改了索引行：缓存必须失效，新条目补一条向量（否则补全模式对新记忆是瞎的）
    recaller.invalidate()
    if (out.episodeId) void recaller.warmVectorFor(out.episodeId)
    if (out.episodeId) {
      const ep = store.get(out.episodeId)
      if (ep) {
        events.push({
          name: EVENTS.episodeCreated,
          v: 1,
          at: Date.now(),
          dedupeKey: dedupeKey(ep.id, ep.version),
          payload: { episodeId: ep.id, session: ep.anchor.sessionId, summary: ep.summary },
        })
      }
    }
    return out
  }

  /**
   * 把空闲的事件段关掉。
   * 皮层只蒸 state !== 'open' 的；段一直是 open，皮层就永远没新数据——死锁。
   */
  async function settleEpisodes(opts = {}) {
    const at = Date.now()
    const force = Boolean(opts?.force)
    const idleMs = Number(opts?.idleMs ?? (force ? 0 : 60 * 1000))
    let closed = 0
    for (const ep of store.allEpisodes()) {
      if (ep.state !== 'open' || ep.test) continue
      if (at - Number(ep.end || ep.start) < idleMs) continue
      ep.state = 'closed'
      ep.closedAt = at
      ep.version += 1
      store.touch(ep)
      store.openBySession.delete(ep.anchor.sessionId)
      await appendJsonl(FILES.episodes, ep)
      closed += 1
    }
    // settle-then-consolidate：关完段立刻巩固一次，
    // 不然要等 10 分钟一次的浅巩固，皮层那页看起来"永远不强"。
    if (closed > 0) {
      try { await tick({ deep: false }) } catch { /* 巩固失败不影响关段 */ }
    }
    return { closed, at, idleMs, force }
  }

  // ── 定期任务：关段、衰减、巩固 ─────────────────────────────────
  async function tick({ deep = false } = {}) {
    try {
      const now = Date.now()
      // L2-11 信息流速：密度高就把段切短；没有数据时按 15 分钟
      let gapMs = 15 * 60 * 1000
      try {
        const density = await messageDensity(await recentRaw(1), now)
        gapMs = density.gapMs
        runtime.density = density
      } catch { /* 没 raw 就按默认 */ }
      for (const sid of store.bySession.keys()) store.closeIfStale(sid, now, gapMs)

      // 长会话也要能落段：一段开太久，内容全糊在同一条里，页面就永远看不到新记忆。
      // 超过 90 分钟强制收段，下一条消息会开新的一段。
      for (const ep of store.allEpisodes()) {
        if (ep.state !== 'open' || ep.test) continue
        if (now - Number(ep.start || 0) <= 90 * 60 * 1000) continue
        ep.state = 'closed'
        ep.closedAt = now
        ep.version += 1
        store.touch(ep)
        try { store.openBySession.delete(ep.anchor?.sessionId) } catch { /* 没有索引就跳过 */ }
        void appendJsonl(FILES.episodes, ep)
      }

      // 增量边落盘（L2-3）+ 每小时压一次容量（L2-12）
      if (store.pendingEdges.length) await appendLinks(store.pendingEdges.splice(0))
      if (!runtime.lastCapacityAt || now - runtime.lastCapacityAt > 60 * 60 * 1000) {
        runtime.lastCapacityAt = now
        try { runtime.capacity = await enforceCapacity() } catch { /* 压不动下次再来 */ }
      }

      const swept = await sweepOnce(store, now)

      // 给前额叶的 traces 接缝：同步读缓存，不读盘
      if (!runtime.traceStats || now - runtime.traceStatsAt > 60 * 1000) {
        runtime.traceStatsAt = now
        try {
          const rows = await readJsonl(FILES.traces, { limit: 200 })
          runtime.traceStats = {
            total: rows.length,
            at: now,
            recent: rows.slice(-5).map((r) => ({
              at: r.at,
              query: String(r.query || '').slice(0, 40),
              mode: r.mode,
              hits: Array.isArray(r.hits) ? r.hits.length : 0,
            })),
          }
        } catch { /* 读不到就保持上一次的 */ }
      }
      let result = null
      // 不能只等"安静 30 分钟"——一直在聊天就永远等不到，积压清不掉，皮层也就没有新东西。
      const pendingClosed = store.allEpisodes().filter((e) => e.state === 'closed' && !e.test).length
      if (shouldRunNow({
        pending: pendingClosed,
        lastConsolidateAt: runtime.lastConsolidate,
        now,
        quiet: consolidator.quiet(now, deep ? 0 : 30),
      })) {
        result = await consolidator.run({ mode: deep ? 'deep' : 'shallow', now })
        if (result?.processed) runtime.lastConsolidate = now
        // 标签-捕获：巩固完把显著性绑到 episode id 上。
        // 以前杏仁核只收到 text，分数 id 恒为 null —— 打了 8658 次分，没有一条记得住。
        if (result?.processed) {
          try {
            const amy = ctx.get('memory.amygdala')
            if (amy && typeof amy.bind === 'function') {
              let bound = 0
              for (const ep of (store.allEpisodes ? store.allEpisodes() : [])) {
                if (!ep?.id || ep.amygBound) continue
                if (!Number.isFinite(Number(ep.salience))) continue
                const r = amy.bind({
                  id: ep.id,
                  score: Number(ep.salience) || 0,
                  confidence: Number(ep.confidence) || 0,
                  tags: ep.tags || [],
                  source: { channel: 'consolidate' },
                })
                if (r && !r.skipped) { ep.amygBound = Date.now(); bound += 1 }
              }
              if (bound) runtime.lastAmygBind = { at: now, bound }
            }
          } catch { /* 绑不上不影响巩固 */ }
        }
      }
      return { swept, consolidate: result }
    } catch (error) {
      runtime.lastError = String(error?.message || error)
      return { error: runtime.lastError }
    }
  }

  // ── 工具（给 Agent 用）──────────────────────────────────────
  const tools = [
    makeTool('hippocampus_recall', '在海马体里找记忆：给一段模糊的话就联想（complete），给账号/号码/原话就精确命中（separate）。返回事件摘要与理由，不返回全文。', {
      query: { type: 'string' },
      mode: { type: 'string', enum: ['auto', 'complete', 'separate'] },
      k: { type: 'integer', minimum: 1, maximum: 10, default: 5 },
    }, ['query'], async (args, exec) => {
      const out = await recaller.recall(args.query, { mode: args.mode || 'auto', k: args.k || 5 })
      return { ok: true, session: exec?.agent?.id || '', ...out }
    }),
    makeTool('hippocampus_write', '手动写一条进海马体（一般不用，会话消息会自动写）。', {
      text: { type: 'string' },
      role: { type: 'string', enum: ['user', 'assistant'] },
    }, ['text'], async (args, exec) => {
      const session = String(exec?.agent?.id || 'manual')
      return write({ session, role: args.role || 'user', text: args.text, at: Date.now(), channel: 'tool' })
    }),
    makeTool('hippocampus_sequence', '按时间顺序看一件记忆之前/之后发生了什么。', {
      episodeId: { type: 'string' },
      direction: { type: 'string', enum: ['after', 'before'] },
      limit: { type: 'integer', minimum: 1, maximum: 10, default: 5 },
    }, ['episodeId'], async (args) => ({ ok: true, items: await recaller.sequence(args.episodeId, args.direction || 'after', args.limit || 5) })),
    makeTool('hippocampus_settle', '把空闲的事件段关掉。皮层只蒸 state=closed 的，段一直 open 它就永远拿不到新数据。force=true 强制全关。', {
      force: { type: 'boolean', description: 'true = 不管空闲多久，全关' },
      idleMs: { type: 'integer', description: '空闲多少毫秒算过期，默认 60000' },
    }, [], async (args) => ({ ok: true, ...(await settleEpisodes(args)) })),
    makeTool('hippocampus_consolidate', '手动跑一次巩固（重放/抽取/拼接）。dryRun 先看会动哪些。', {
      dryRun: { type: 'boolean' },
      mode: { type: 'string', enum: ['shallow', 'deep'] },
    }, [], async (args) => {
      if (args.dryRun) {
        const pending = store.allEpisodes().filter((e) => e.state === 'closed').length
        return { ok: true, dryRun: true, pending }
      }
      return { ok: true, ...(await consolidator.run({ mode: args.mode || 'shallow' })) }
    }),
    makeTool('hippocampus_stats', '看海马体现状：多少事件、多少索引、向量覆盖、三个器官在不在。', {}, [], async () => {
      const s = store.stats()
      const st = await recaller.stats()
      return { ok: true, version: VERSION, ...s, ...st, capabilities: adapters.capabilities, health: runtime.health }
    }),
    makeTool('hippocampus_health', '海马体自检：数据目录、meta 版本、悬空索引、消息密度。', {}, [], async () => {
      const raw = await recentRaw(30)
      const dangling = await detectDangling(store, raw)
      const density = await messageDensity(raw)
      return {
        ok: true,
        health: await healthCheck(),
        dangling: dangling.length,
        density,
        capacity: runtime.capacity || null,
        stats: store.stats(),
      }
    }),
    makeTool('hippocampus_rebuild', '从 raw 重建 episode 与索引（会先备份 episodes）。只在索引坏了时用。', {}, [], async () => {
      const out = await rebuildFromRaw(store, encoder)
      for (const sid of store.bySession.keys()) refreshContext(sid)
      return { ok: true, ...out }
    }),
  ]

  // 主动想起的状态：当前这句要不要带一句旧事 / 每条上次冒出来的时间
  runtime.proactive = runtime.proactive || new Map()
  runtime.surfaced = runtime.surfaced || new Map()

  async function surfacing(sessionId, text) {
    runtime.lastSurfacing = { at: Date.now(), session: sessionId, text: String(text || '').slice(0, 40), stage: 'start' }
    try {
      if (String(text || '').length < 4) return
      runtime.lastSurfacing.stage = 'recalled'
      const out = await recaller.recall(String(text), { k: 5 })
      runtime.lastSurfacing.hits = (out?.hits || []).length
      const pick = pickProactive(out?.hits || [], { now: Date.now(), surfaced: runtime.surfaced })
      runtime.lastSurfacing.pick = pick ? pick.id : null
      runtime.lastSurfacing.stage = pick ? 'picked' : 'none'
      if (process.env.DSH_PROACTIVE_DEBUG) console.error('[pro]', JSON.stringify({ n: (out?.hits||[]).length, pick: pick && pick.id, top: (out?.hits||[]).slice(0,3).map(h=>({id:h.episodeId||h.id,s:h.score})) }))
      if (!pick) { runtime.proactive.delete(sessionId); return }
      runtime.surfaced.set(pick.id, Date.now())
      runtime.proactive.set(sessionId, proactiveLine(pick))
      runtime.lastSurfacing.keys = [...runtime.proactive.keys()]
      runtime.lastSurfacing.line = proactiveLine(pick).slice(0, 30)
      runtime.lastProactive = { at: Date.now(), id: pick.id, score: Number(pick.score.toFixed(3)) }
    } catch (error) {
      runtime.lastError = 'proactive:' + String(error?.message || error)
    }
  }

  // ── 挂载 Agent：注入 + 两个写钩子 ──────────────────────────────
  function mount(agent) {
    if (!agent?.ctx || !agent.id || runtime.mounted.has(agent.id)) return
    const sessionId = String(agent.id)
    runtime.mounted.add(sessionId)
    refreshContext(sessionId)

    // 注入开关：config.json 的 inject.hippocampus === false 时，不往 system prompt 写（工具照常可用）
    if (globalThis.__DSH_ALL_INJECT__?.hippocampus !== false) {
      try {
        const dispose = agent.ctx.systemPrompt.context({
          name: 'hippocampus-index',
          order: 920,
          required: false,
          interpolate: false,
          text: () => runtime.contextCache.get(sessionId) || composeContext(sessionId),
        })
        agent.ctx.effect?.(dispose)
      } catch (error) {
        runtime.lastError = String(error?.message || error)
      }

      // 主动想起：不是等被问，是"这句话让我想起了什么"。
      // 门槛高、一轮最多一条、同一条冷却 30 分钟——宁可这轮不冒，也别扯旧账。
      try {
        const dispose = agent.ctx.systemPrompt.context({
          name: 'memory-proactive',
          order: 919,
          required: false,
          interpolate: false,
          text: () => {
            if (process.env.DSH_PRO_READ_DEBUG) console.error('[read]', sessionId, runtime.proactive.size, [...runtime.proactive.keys()].join('|'))
            const own = runtime.proactive.get(sessionId)
            if (own) return own
            const keys = [...runtime.proactive.keys()]
            return keys.length ? runtime.proactive.get(keys[keys.length - 1]) : ''
          },
        })
        agent.ctx.effect?.(dispose)
      } catch (error) {
        runtime.lastError = String(error?.message || error)
      }
    }

    const offInbox = agent.ctx.on('agent/inbox/inserted', async ({ message } = {}) => {
      try {
        const text = textOf(message)
        if (!text) return
        await write({ session: sessionId, role: 'user', text, at: Date.now(), channel: 'inbox', msgId: message?.id })
        void surfacing(sessionId, text)
      } catch (error) {
        runtime.lastError = String(error?.message || error)
      }
    })

    const offStop = agent.ctx.on('agent/turn-stopping', async () => {
      try {
        const now = Date.now()
        for (const sid of store.bySession.keys()) store.closeIfStale(sid, now)
        await flushVectors()
      } catch { /* 收尾失败不影响对话 */ }
    })

    agent.ctx.effect?.(() => {
      offInbox?.()
      offStop?.()
      runtime.mounted.delete(sessionId)
    })
  }

  // 启动补挂（插件重载后已有 Agent 不会重放 created）
  // 会话事件也触发一次主动想起：agent 级钩子在某些宿主里不保证送达，
  // 这里走的是全module级的 session/event（夹具和线上都通）。
  try {
    ctx.on?.('session/event', (session, event) => {
      try {
        const type = event?.type
        if (type !== 'user/message' && type !== 'assistant/message') return
        const d = event?.data
        const body = String(d?.text ?? d?.message?.text ?? d?.content ?? '')
        if (!body) return
        const sid = String(session?.id ?? session?.sessionId ?? session ?? '')
        if (!sid) return
        void surfacing(sid, body)
      } catch { /* 单条失败不拖累 */ }
    })
  } catch { /* 没有事件总线 */ }

  try {
    for (const agent of ctx.agents?.list?.() || []) mount(agent)
  } catch { /* 列不出来就等 created */ }
  try {
    ctx.effect?.(ctx.on('agent/created', ({ agent }) => { try { mount(agent) } catch { /* 单个失败不拖累 */ } }))
  } catch { /* 没有事件系统就只靠轮询 */ }

  // 兜底轮询：4 秒对一次，把没挂上的补上
  const poll = setInterval(() => {
    try {
      for (const agent of ctx.agents?.list?.() || []) if (!runtime.mounted.has(String(agent?.id))) mount(agent)
    } catch { /* 下一轮再说 */ }
  }, 4000)
  poll.unref?.()
  ctx.effect?.(() => clearInterval(poll))

  // session/event 兜底写入（QQ / Web 这类不走 agent ctx 的会话）
  // 以前这里写死 type === 'user/message'，名字一旦不同就一条都进不来（实测：raw 里只剩心情写回）。
  // 现在只要事件名里带 message 就认，并把"看没看到 / 写没写进去"记在 runtime 里，能自查。
  try {
    ctx.effect?.(ctx.on('session/event', async (session, event) => {
      try {
        const type = String(event?.type || '')
        hookBeat('session/event', { type, keys: Object.keys(event || {}), dataKeys: Object.keys(event?.data || {}) })
        if (!type.includes('message')) return
        runtime.seen = Number(runtime.seen || 0) + 1
        runtime.lastType = type
        const role = type.startsWith('assistant') ? 'assistant' : 'user'
        const d = event?.data || {}
        const text = textOf(d) || pickTextAny(d)
        if (!text) {
          runtime.lastSkip = 'empty-text'
          // 形状诊断：不知道宿主event长什么样就只能猜，猜了十几轮。这里把真实形状落盘一次。
          try {
            const { appendFileSync, mkdirSync } = await import('node:fs')
            const dir = process.env.HIPPOCAMPUS_DIR || 'C:/Users/64091/.dsh/hippocampus'
            mkdirSync(dir, { recursive: true })
            appendFileSync(dir + '/_shape-debug.jsonl', JSON.stringify({ at: Date.now(), type, data: event?.data, keys: Object.keys(event || {}) }).slice(0, 1200) + '\n')
          } catch { /* 诊断失败不影响对话 */ }
          return
        }
        runtime.lastText = text.slice(0, 40)
        const sessionId = String(session?.id ?? session?.header?.id ?? 'unknown')
        await write({ session: sessionId, role, text, at: Date.now(), channel: 'session' })
        runtime.written = Number(runtime.written || 0) + 1
      } catch (error) {
        runtime.lastError = String(error?.message || error)
      }
    }))
  } catch { /* 没有这个事件就算了 */ }

  // 全局收件箱兜底：agent 级钩子只在 agent/created 时挂上，
  // 如果插件比 agent 晚加载（或者 agents.list() 返回空），就一条都收不到。
  // 宿主真正发的是 agent/inbox/inserted（已从 DSH 源码确认），这里在模块级也挂一次。
  try {
    ctx.effect?.(ctx.on('agent/inbox/inserted', async ({ message } = {}) => {
      try {
        hookBeat('inbox', { keys: Object.keys(message || {}) })
        runtime.seen = Number(runtime.seen || 0) + 1
        runtime.lastType = 'agent/inbox/inserted'
        const text = textOf(message)
        if (!text) { runtime.lastSkip = 'inbox-empty-text'; return }
        runtime.lastText = String(text).slice(0, 40)
        const sid = String(message?.sessionId ?? message?.session ?? message?.sessionID ?? 'inbox')
        await write({ session: sid, role: message?.role === 'assistant' ? 'assistant' : 'user', text, at: Date.now(), channel: 'inbox-global', msgId: message?.id })
        runtime.written = Number(runtime.written || 0) + 1
      } catch (error) {
        runtime.lastError = String(error?.message || error)
      }
    }))
  } catch { /* 没有这个事件总线就算了 */ }

  // 事件送不到，就自己拉：每 15 秒翻一次 agent.session.surface.nodes。
  // 用裸 setInterval，不用 lib/clock 的 every()：后者在这里从未触发过（探针能触发、every 不触发）。
  const pullCursors = loadCursors()
  try {
    const pullTimer = setInterval(() => {
      // 每 15 秒扫一次会话投影缓存；每个文件一个游标，首次只对齐不补历史。
      const files = recentCacheFiles()
      void pullFromCache(files, pullCursors, async (it) => {
        hookBeat('pull', { role: it.role, seq: it.seq, n: it.text.length, file: String(it.sessionId).slice(0, 18) })
        await write({ session: String(it.sessionId).replace(/\.json$/, ''), role: it.role, text: it.text, at: Date.now(), channel: 'cache-pull' })
        runtime.written = Number(runtime.written || 0) + 1
      }).then((detail) => {
        hookBeat('pull-tick', { files: files.length, detail })
        saveCursors(pullCursors)
      }).catch((error) => { runtime.lastError = String(error?.message || error) })
    }, 15000)

    pullTimer.unref?.()
    ctx.effect?.(() => () => clearInterval(pullTimer))
  } catch (error) {
    runtime.lastError = String(error?.message || error)
  }

  // 定期：浅巩固每 10 分钟；夜间深巩固一天一次（统一拍子，见 lib/clock.js）
  const shallowTimer = setInterval(() => { void tick({ deep: false }) }, 10 * 60 * 1000)
  shallowTimer.unref?.()
  ctx.effect?.(() => () => clearInterval(shallowTimer))
  const deepTimer = setInterval(() => {
    const now = Date.now()
    if (new Date(now).getHours() !== 3) return
    void tick({ deep: true })
  }, 60 * 60 * 1000)
  deepTimer.unref?.()
  ctx.effect?.(() => () => clearInterval(deepTimer))
  hookBeat('apply-end', { at: Date.now() })
  // 清理已各自注册

  // 启动预热：只预热最近索引行的向量（后台）。
  // 以前这两件事是并发的：索引还没建好就 warm，rows() 可能是空的，
  // warm 拿 0 行、返回 done=0，然后再也不重试——向量就永远是 false。
  // 现在先等 primeIndex 完成再 warm；没铺上就隔 20 秒再试，最多 4 次。
  const warmAtBoot = async (attempt = 0) => {
    try {
      await recaller.primeIndex()
      const r = await recaller.warmVectors(120)
      runtime.vecReady = (r?.done || 0) > 0
      runtime.lastWarm = { at: Date.now(), done: r?.done || 0, total: r?.total || 0, attempt }
      if (!runtime.vecReady && attempt < 3) {
        setTimeout(() => { void warmAtBoot(attempt + 1) }, 20000).unref?.()
      }
    } catch (error) {
      runtime.lastWarm = { at: Date.now(), error: String(error?.message || error), attempt }
      if (attempt < 3) setTimeout(() => { void warmAtBoot(attempt + 1) }, 20000).unref?.()
    }
  }
  setTimeout(() => { void warmAtBoot() }, 5000).unref?.()

  // ── 服务 & 面板 ─────────────────────────────────────────────
  // 除了海马体自己用，这一层还是三个器官的接缝：
  // 前额叶的 SEAMS.mem = recall / episode / traces / source / conflicts（都是同步调）
  // 皮层的 pipeline 用 episodes({since,limit})，traces.js 用 traces()
  const api = {
    version: VERSION,
    write,
    // traces() 读的是 runtime.traceStats 这份缓存，而缓存只在后台 tick 里从
    // traces.jsonl 重读一次（60 秒一次）。刚 recall 完立刻读 traces() 一定是 0，
    // 对外就像"这个接口永远空着"。所以检索成功时就把这一条记进缓存。
    // （合计数在 tick 刷新前是"本次启动以来"的数，刷新后才是文件里的总数。）
    recall: async (q, opts) => {
      const out = await recaller.recall(q, opts)
      // 实词优先：问"海边"就先想起海边那条。放在最外层，确保是所有排序之后的最终顺序。
      const literalCueFirst = (result, queryText) => {
        try {
          const text = typeof queryText === 'string' ? queryText : String(queryText?.query || queryText?.text || '')
          const terms = text.split(/[\s，。、；：！？,.;:!?]+/u).filter((w) => w.length >= 2)
          if (!terms.length || !result || !Array.isArray(result.hits)) return result
          const cueOf = (h) => {
            const hay = JSON.stringify(h || {}).toLowerCase()
            let n = 0
            for (const t of terms) {
              const term = t.toLowerCase()
              if (hay.includes(term)) { n += 1; continue }
              // 「吵架」对「吵了一架」这种：两个字都在，算半个命中，别因为不是连写就当成没想起来
              if (term.length === 2 && hay.includes(term[0]) && hay.includes(term[1])) n += 0.5
            }
            return n
          }
          // 只有在真的有字面命中时才重排；一个都没命中就保持原来的语义排序
          const cueList = result.hits.map(cueOf)
          if (Math.max(...cueList) <= 0) return result
          result.hits = [...result.hits].sort((a, b) => (cueOf(b) - cueOf(a)) || (Number(b.score) - Number(a.score)))
          return result
        } catch { return result }
      }
      if (out && Array.isArray(out.hits)) literalCueFirst(out, q)
      try {
        const hitList = Array.isArray(out) ? out : (out?.hits || [])
        const prev = runtime.traceStats || { total: 0, at: 0, recent: [] }
        const at = Date.now()
        runtime.traceStats = {
          total: Number(prev.total || 0) + 1,
          at,
          recent: [
            ...(Array.isArray(prev.recent) ? prev.recent : []),
            { at, query: String(q || '').slice(0, 40), mode: out?.mode, hits: hitList.length },
          ].slice(-5),
        }
        runtime.traceStatsAt = at
      } catch { /* 缓存坏了不影响检索 */ }
      return out
    },
    // 同步召回：给心情插件在同一拍里用。毫秒级、不阻塞、不写缓存。
    // 返回 { ok, degraded, valenceReady, hits:[{id,brief,valence,salience,at,score,why}], ms }
    recallSync: (q, opts) => recaller.recallSync(q, opts),
    proactiveDebug: () => runtime.lastSurfacing || null,
    // 预热向量的口子：启动时内部会自己跑一次，但外部（测试/运维）也需要能主动补。
    warmVectors: (limit) => recaller.warmVectors(limit),
    /**
     * 长期情绪统计：给人格层读的口子（只读，不改任何东西）。
     * 回答的是"这段时间她的记忆整体是什么颜色、这个颜色稳不稳"。
     */
    moodTrend: (opts = {}) => {
      const days = Math.max(1, Math.min(365, Number(opts.days) || 30))
      const since = Date.now() - days * 86400_000
      const eps = store.allEpisodes().filter((e) => Number(e.start) >= since)
      // 注意 Number(null) === 0：以前这里把"没有效价"当成 0 算进去，
      // withValence 虚高、平均值被稀释成 0——看起来有数据，其实没测到情绪。
      const withV = eps.filter((e) => e.valence !== null && e.valence !== undefined && Number.isFinite(Number(e.valence)))
      const byDay = {}
      for (const e of withV) {
        const d = new Date(Number(e.start)).toISOString().slice(0, 10)
        if (!byDay[d]) byDay[d] = { n: 0, sum: 0 }
        byDay[d].n += 1
        byDay[d].sum += Number(e.valence)
      }
      const trend = Object.keys(byDay).sort().map((d) => ({
        day: d,
        n: byDay[d].n,
        avg: Number((byDay[d].sum / byDay[d].n).toFixed(3)),
      }))
      const avg = withV.length
        ? withV.reduce((s, e) => s + Number(e.valence), 0) / withV.length
        : 0
      // 撑住判断的样本够不够：少于 5 条就明说"还看不出来"
      return {
        ok: true,
        days,
        episodes: eps.length,
        withValence: withV.length,
        coverage: eps.length ? Number((withV.length / eps.length).toFixed(3)) : 0,
        avgValence: Number(avg.toFixed(3)),
        confidence: withV.length >= 5 ? 'ok' : 'thin',
        trend,
      }
    },
    sequence: (id, dir, n) => recaller.sequence(id, dir, n),
    context: (sessionId) => runtime.contextCache.get(sessionId) || composeContext(sessionId),
    consolidate: (opts) => consolidator.run(opts),
    tick,
    settle: settleEpisodes,
    layers,

    /**
     * 给星图 / 可视化用的只读投影。
     * 格式对齐 Companion 星图吃的 { nodes:[{id,type,label,full}], edges:[{s,t,w}] }，
     * 前端不用改。
     */
    graph: (opts = {}) => {
      const { limit = 800 } = opts || {}
      const g = store.graph
      const nodes = []
      let 事实 = 0
      let 实体 = 0
      for (const n of g.nodes.values()) {
        if (nodes.length >= limit) break
        let label = n.label || String(n.id)
        const 是事件 = n.type === 'event'
        if (是事件) {
          const ep = store.get(String(n.id).replace(/^e:/, ''))
          if (ep && ep.summary) label = ep.summary
          事实 += 1
        } else {
          实体 += 1
        }
        nodes.push({
          id: n.id,
          // 星图前端只认 fact / entity / topic / cluster
          type: 是事件 ? 'fact' : 'entity',
          label,
          full: label,
          weight: Number(n.weight) || 1,
        })
      }

      // 星图前端强依赖 cluster 节点：它按星团做归属和分布，没有星团会直接崩。
      // 按"天"切星团——记忆天然按天聚，读起来也像星座。
      const 天键 = (ms) => {
        const d = new Date(Number(ms) || Date.now())
        return `${d.getMonth() + 1}/${d.getDate()}`
      }
      const clusters = new Map() // 天 → clusterId
      const clusterEdges = []
      for (const n of nodes) {
        if (n.type !== 'fact') continue
        const ep = store.get(String(n.id).replace(/^e:/, ''))
        if (!ep) continue
        const k = 天键(ep.start)
        if (!clusters.has(k)) {
          const cid = `c:${k}`
          clusters.set(k, cid)
          nodes.push({
            id: cid,
            type: 'cluster',
            label: k,
            full: `${k} 的记忆`,
            weight: 1,
            hue: 200,
          })
        }
        clusterEdges.push({ s: clusters.get(k), t: n.id, w: 1 })
      }

      const ids = new Set(nodes.map((n) => n.id))
      const edges = [...clusterEdges]
      for (const e of g.edges) {
        if (!ids.has(e.from) || !ids.has(e.to)) continue
        if (edges.length >= limit * 2) break
        edges.push({ s: e.from, t: e.to, w: Number(e.w) || 1 })
      }

      return {
        ok: true,
        // 这几个中文计数是星图前端直接读的字段（旧 graph.json 的形状）
        事实,
        实体,
        主题: 0,
        关系: edges.length,
        簇: clusters.size,
        节点: nodes.length,
        边: edges.length,
        生成于: new Date().toISOString(),
        nodes,
        edges,
        at: Date.now(),
        来源: 'four-organs',
      }
    },

    // ── 给外部的只读投影 ────────────────────────────────────
    episodes: async (opts = {}) => {
      const { since = 0, limit = 50, state = '', session = '', includeTest = false } = opts || {}
      return store.allEpisodes()
        .filter((e) => (!since || e.start >= since)
          && (!state || e.state === state)
          && (!session || e.anchor.sessionId === session)
          && (includeTest || !e.test))
        .sort((a, b) => a.start - b.start)
        .slice(-limit)
        .map((e) => ({
          id: e.id,
          session: e.anchor.sessionId,
          at: e.start,
          end: e.end,
          summary: e.summary,
          text: e.summary,
          // brief 是给消费方（心情的 memoryRecent、人格的后扣带）直接用的短摘要。
          // 没有它，下游只能拿 summary 自己截，截出来的长度和上游不一致。
          brief: String(e.summary || '').slice(0, 40),
          entities: e.entities,
          type: e.type,
          state: e.state,
          confidence: e.confidence,
          salience: e.salience,
          // valence 是"这条记忆当时好坏"。encode 早就写进 episode 了，
          // 但这里不投影，下游读到的恒是 undefined → 被人当 0 用。
          // 心境重排、后扣带的怀旧、长期趋势全都靠它，必须透出来。
          // 没有就明确给 null：不给 0，不假装中性。
          // Number(null) === 0：不先排除 null，缺效价的条目会被投成 0，看起来永远"有情绪"
          valence: (e.valence === null || e.valence === undefined) ? null : (Number.isFinite(Number(e.valence)) ? Number(e.valence) : null),
          causal: Array.isArray(e.causal) ? e.causal : [],
          conflicts: Array.isArray(e.conflicts) ? e.conflicts : [],
          conflictCount: Number(e.conflictCount || 0),
          rawIds: e.rawIds,
          transferState: e.transferState,
        }))
    },
    raw: async (opts = {}) => {
      const { days = 7, limit = 200 } = opts || {}
      const rows = await recentRaw(days)
      return rows.slice(-limit)
    },
    quiet: (opts = {}) => {
      const minutes = Number(opts?.minutes ?? 30)
      return { quiet: consolidator.quiet(Date.now(), minutes), at: Date.now(), minutes }
    },

    // ── 前额叶的五个同步接缝（callSync 不允许返回 Promise）──────
    episode: (id) => {
      const ep = store.get(String(id || ''))
      if (!ep) return null
      return {
        id: ep.id,
        session: ep.anchor.sessionId,
        at: ep.start,
        end: ep.end,
        text: ep.summary,
        summary: ep.summary,
        entities: ep.entities,
        type: ep.type,
        state: ep.state,
        confidence: ep.confidence,
        salience: ep.salience,
        rawIds: ep.rawIds,
        transferState: ep.transferState,
      }
    },
    source: (id) => {
      const ep = store.get(String(id || ''))
      if (!ep) return null
      return {
        kind: ep.anchor?.channel || 'dsh',
        session: ep.anchor?.sessionId || '',
        msgId: ep.anchor?.msgId || '',
        at: ep.start,
      }
    },
    conflicts: () => {
      const out = []
      for (const edge of store.graph.edges) {
        if (edge.kind !== 'conflict') continue
        const a = store.get(String(edge.from || '').replace(/^e:/, ''))
        const b = store.get(String(edge.to || '').replace(/^e:/, ''))
        if (a && b) {
          out.push({ a: a.id, b: b.id, aText: a.summary, bText: b.summary, at: edge.at || 0 })
        }
      }
      return out
    },
    traces: () => runtime.traceStats || { total: 0, at: 0, recent: [] },
    get vectorReady() {
      return Boolean(runtime.vecReady)
    },

    stats: async () => ({
      ...store.stats(),
      ...(await recaller.stats()),
      capabilities: adapters.capabilities,
      vectorReady: Boolean(runtime.vecReady),
      traceStats: runtime.traceStats || null,
    }),
  }
  try { ctx.provide?.('memory.hippocampus', api) } catch { /* 老版本没有 provide */ }
  try { ctx.set?.('memory.hippocampus', api) } catch { /* 同上 */ }

  // 工具注册
  for (const tool of tools) {
    try {
      if (ctx.tools?.get?.(tool.name)) continue
      ctx.tools?.register?.(tool)
    } catch (error) {
      console.error(`[${NAME}] tool register failed:`, tool.name, error)
    }
  }

  // HTTP 面板
  try {
    const ws = ctx.webServer?.register ? ctx.webServer : (ctx.get?.('webServer') ?? null)
    if (ws?.register) {
      ws.register({ kind: 'exact', path: '/hippocampus/state', handler: async (_req, res) => sendJson(res, await api.stats()) })
      ws.register({
        kind: 'exact',
        path: '/hippocampus/recall',
        handler: async (req, res) => {
          const q = new URL(req.url, 'http://x').searchParams.get('q') || ''
          sendJson(res, await recaller.recall(q, { k: 8 }))
        },
      })
      ws.register({ kind: 'exact', path: '/hippocampus/consolidate', handler: async (_req, res) => sendJson(res, await consolidator.run({ mode: 'shallow' })) })
    }
  } catch { /* 没有 webServer 就当纯记忆插件 */ }

  void (async () => {
    try {
      // 已有向量缓存就先亮起来：前额叶启动时探 vectorReady 能读到 true
      try {
        const cached = JSON.parse(readFileSync(FILES.vectors, 'utf8'))
        runtime.vecReady = Object.keys(cached?.vecs || {}).length > 0
      } catch { /* 没缓存就等预热 */ }

      await store.init()
      for (const sid of store.bySession.keys()) refreshContext(sid)
      runtime.health = await healthCheck()
      // L2-14 悬空检测：episode 指向的 raw 不在了就标出来
      try { await detectDangling(store, await recentRaw(30)) } catch { /* 没 raw 就跳过 */ }
      const meta = await readMeta()
      // meta 文件从来没人写过：启动时补一份，别让健康检查一直报“缺失”
      await writeMeta({ ...meta, version: 1 })
    } catch (error) {
      runtime.lastError = String(error?.message || error)
    }
  })()

  return () => { /* 卸载时定时器由 effect 清掉 */ }
}

function makeTool(name, description, properties, required, handler) {
  return {
    name,
    description,
    parameters: { type: 'object', properties, required, additionalProperties: false },
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

function sendJson(res, value) {
  try {
    res.statusCode = 200
    res.setHeader?.('content-type', 'application/json; charset=utf-8')
    res.end?.(JSON.stringify(value))
  } catch { /* 面板出错不炸插件 */ }
}
