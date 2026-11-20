// 前额叶插件入口（单器官可跑 / 多器官留接口）
// 只做"挂载 + 编排 + 对外接口"，功能都在 kernel/ store/ seams/ host/ 里。
// 对应功能总表：F1–F17 接入面、P5 协作层、H1–H8 交接协议。
import { plan as makePlan } from './kernel/plan.js'
import { judge as runJudge, invariant, markRestatement } from './kernel/judge.js'
import { shouldRemember, hardRule } from './kernel/gate.js'
import { again as retry } from './kernel/iterate.js'
import * as expand from './kernel/expand.js'
import * as decay from './kernel/decay.js'
import * as score from './kernel/score.js'
import * as conflictKernel from './kernel/conflict.js'
import * as cap from './kernel/budget.js'
import { tokens } from './kernel/text.js'
import * as hint from './kernel/hint.js'
import * as flags from './kernel/flags.js'
import * as meta from './kernel/meta.js'
import * as hot from './store/hot.js'
import * as tasks from './store/tasks.js'
import * as ledger from './store/ledger.js'
import * as conflicts from './store/conflicts.js'
import * as migrate from './store/migrate.js'
import { probe as probeOrgans, shadow, explain as explainSeams } from './seams/registry.js'
import { syncSeams, capabilityTable, callAsync, absent, amyAdjust } from './seams/adapters.js'
import * as telemetry from './host/telemetry.js'
import * as injectHost from './host/inject.js'
import * as life from './host/life.js'
import { readJson, writeJson } from './store/jsonl.js'
import { FILES } from './store/paths.js'
import { buildWorkingSet } from './workset.js'

const NAME = 'prefrontal'
const VERSION = '0.1.0'

// 不声明 inject，ctx.get('tools'/'agents'/'webServer') 拿不到，工具和面板会静默不注册。
// 这是 P1-3 的根因：另外三个器官都没写这一行，工具全哑了。
export const inject = ['tools', 'webServer', 'agents']

export function apply(ctx) {
  // 取服务一律走 ctx.get：直接取 ctx.xxx 会被 Cordis 的 inject 守卫拦下（"without inject"），
  // 那一抛整个插件就变"异常"了。这是本插件唯一允许碰 ctx 服务的方式。
  const svc = (name) => {
    try { return ctx?.get?.(name) ?? null } catch { return null }
  }
  // 探针（P1-3 后半）：**现探 + 500ms 节流**，不把启动那一刻的快照焊死。
  // 谁先 apply 都不会瞎：用的时候才看，晚到 3 秒的器官照样接得上。
  let probeCache = null
  let probeAt = 0
  const PROBE_TTL = 500
  function probeNow(force = false) {
    const t = Date.now()
    if (!force && probeCache && t - probeAt < PROBE_TTL) return probeCache
    try {
      probeCache = probeOrgans(ctx)
    } catch (e) {
      life.note(e) // 探测失败只是"这一下看不见"，不是崩溃
    }
    probeAt = t
    return probeCache
  }
  /** seams 也跟着现探走：探针更新了，接缝立刻换新的。 */
  function seamsNow() {
    return syncSeams(probeNow().organs)
  }
  const runtime = {
    mounted: new Set(),
    contextCache: new Map(),
    calibration: null,
    drift: new Map(),
    lastTurn: new Map(),
    lastIntent: new Map(),
    shadowOrgans: new Set(),
    lastError: null,
    decayed: 0,
  }

  // ── 小工具 ───────────────────────────────────────────────
  const asHits = (raw) => {
    if (!raw) return []
    if (Array.isArray(raw)) return raw
    if (Array.isArray(raw.hits)) return raw.hits
    return []
  }
  const asCov = (raw) => (raw && Number.isFinite(raw.coverage) ? raw.coverage : 0)
  const asLow = (raw) => Boolean(raw?.lowConfidence)

  function caps() {
    return capabilityTable(probeNow().organs)
  }

  function baseCtx(session, extra = {}) {
    const task = tasks.current(session)
    return {
      now: Date.now(),
      session,
      task: task?.goal || null,
      openTasks: tasks.list(session, { open: true }).length || 1,
      turn: runtime.lastTurn.get(session) || 0,
      calibration: runtime.calibration || {},
      capabilities: caps(),
      coverage: 0,
      rules: task?.rules || [],
      ...extra,
    }
  }

  // ── A1 pf.retrieve：慢路（前额叶主导，可迭代）──────────────
  async function retrieve(query, opts = {}) {
    const session = String(opts.session || 'default')
    const budget = cap.cap(opts.profile || 'slow', opts.budget || {})
    const started = Date.now()
    telemetry.inc('retrieve')

    const p = makePlan(query, { ...baseCtx(session), ...opts, budget, expanded: expandedQuery(query) })
    // 扩写要拆成"一个词一路"，不能拼成长串——BM25 对长查询天然稀释，
    // 拼成一串反而让覆盖词多的那条（噪声）赢过真正相关的那条（上一轮踩过）。
    const altWords = (() => {
      if (!p.expanded || p.expanded === p.query) return []
      const tail = String(p.expanded).replace(String(p.query), '').trim()
      const seen = new Set(tokens(query))
      return [...new Set(tail.split(/[\s,，、]+/).filter(Boolean))]
        .filter((w) => w.length >= 2 && !seen.has(w))
        .slice(0, 6)
    })()
    const rounds = []
    const pool = new Map()
    let first = null
    let used = p
    let lowConf = true

    for (let round = 1; round <= budget.rounds; round += 1) {
      // 第一轮：原句；第二轮：每个扩展词各查一次（短查询，互不稀释）
      let queries
      if (round === 2 && altWords.length) {
        used = { ...used, strategy: 'expand' }
        queries = altWords
      } else {
        queries = [used.query]
      }

      let got = 0
      let cov = 0
      for (const q of queries) {
        if (cap.remaining(started, budget.ms) <= 0) break
        // 只传海马体认识的：mode / k / limit / 时间过滤。
        // 千万不要传 session —— 它会被当成"只在这一会话里找"，跨会话记忆全滤空（踩过一次）。
        const raw = await callAsync('mem.recall', probeNow().organs.hippocampus?.recall, {
          deadline: Math.max(60, Math.min(budget.ms, cap.remaining(started, budget.ms))),
          args: [q, {
            mode: used.mode,
            ...used.filters,
            k: budget.items,
            limit: budget.items,
          }],
        })
        const hits = asHits(raw.tri === 'value' ? raw.value : null)
        cov = Math.max(cov, asCov(raw.tri === 'value' ? raw.value : null))
        got += hits.length
        for (const h of hits) {
          const id = h.episodeId || h.id
          const prev = pool.get(id)
          if (!prev || (Number(h.score) || 0) > (Number(prev.score) || 0)) pool.set(id, h)
        }
      }
      const merged = [...pool.values()]
      const r = runJudge(merged, {
        ...baseCtx(session),
        plan: used,
        coverage: cov,
        topicDirection: opts.topicDirection,
        justSwitched: opts.justSwitched,
        seams: seamsNow(),
        round,
        // P3-6：以前压过、现在又冒头 → 打 reappeared 标
        wasSuppressed: (id) => ledger.wasSuppressed(id),
      })
      rounds.push({ round, strategy: used.strategy || 'first', queries: queries.length, hits: got, kept: r.verdicts.length })
      if (!first) first = { r, hits: merged, coverage: cov }
      lowConf = r.verdicts.length === 0 || (r.verdicts[0]?.confidence ?? 0) < 0.45

      // 有扩写、且结果还不够，就先跑扩写轮——多路召回不该等"低置信"才补
      if (altWords.length && round === 1 && merged.length < budget.items) continue
      if (!lowConf || round >= budget.rounds) {
        first = { r, hits: merged, coverage: cov }
        break
      }
      // 预算闸（P1-8）：到点就停，不许越搜越久
      if (cap.remaining(started, budget.ms) <= 0) break

      const next = retry(query, { lowConfidence: true, hits: merged, coverage: cov, mode: used.mode, filters: used.filters }, {
        round,
        tried: rounds.map((x) => x.strategy).filter((s) => s !== 'first'),
        now: Date.now(),
        k: budget.items,
      })
      if (!next) break
      // 黑名单（R9）：失败过的策略不许再来
      if (ledger.strategyBlocked(next.strategy, p.intent)) break
      used = { ...used, ...next }
      // P1-5：放宽那一轮，顺手换一个说法再试（扩写真的用上了）
      if (next.strategy === 'broaden') {
        const alt = expand.variants(query, expand.DICT).find((v) => v !== used.query)
        if (alt) used = { ...used, query: alt, why: [...(used.why || []), 'expand'] }
      }
    }

    const result = first?.r || { verdicts: [], suppressed: [], flags: [], meta: {} }
    result.verdicts = markRestatement(result.verdicts, first?.hits || [])

    // 记账 + 出队 + 写回
    try {
      // 以前这里直接用 session：调用方没传就落到 'default'，
      // 真实会话永远拿不到热区，而 default 每次都被刷新——统计看起来"空的"其实是写错了池子。
      const sidFor = session || runtime.lastSessionId || ''
      // 没有真实会话就不写：以前兜底成 latestSession()，而 default 因为被写而永远最新，
      // 于是每一轮都在刷新 default，真实会话永远拿不到热区（自我循环）。
      if (sidFor && sidFor !== 'default') await hot.refresh(sidFor, first?.hits || [], { now: Date.now() })
      await ledger.verdict({
        query: String(query).slice(0, 120),
        intent: p.intent,
        mode: p.mode,
        hits: result.verdicts.map((v) => v.id),
        conf: result.verdicts[0]?.confidence ?? 0,
        flags: result.flags,
      })
      await ledger.suppress(result.suppressed)
      await conflicts.enqueue(result.conflicts)
      if (result.verdicts.length === 0) {
        await ledger.blacklistStrategy(used.strategy || 'first', p.intent, '空手')
      }
    } catch (e) {
      runtime.lastError = String(e?.message || e)
    }

    runtime.lastTurn.set(session, (runtime.lastTurn.get(session) || 0) + 1)
    runtime.lastIntent.set(session, p.intent)

    return {
      ok: true,
      plan: { intent: p.intent, mode: p.mode, filters: p.filters, target: p.target, why: p.why },
      rounds,
      hits: result.verdicts,
      suppressed: result.suppressed,
      conflicts: result.conflicts,
      constraint: result.constraint,
      adopted: result.adopted,
      // F17：把"别往这找/往这找"真的交出去（海马不认就忽略）
      hint: hint.hint(used, result.suppressed),
      flags: result.flags,
      meta: result.meta,
      budget: { profile: opts.profile || 'slow', ...budget },
      elapsedMs: Date.now() - started,
      seams: explainSeams(probeNow()),
    }
  }

  // ── A2/A3/A4：被调的三个入口 ──────────────────────────────
  /**
   * 问皮层要"同义/上位词"扩写（P1-5 的消费方）。
   * 它返回的是"原句 + 空格 + 扩展词"的整串；拿不到就 null，计划照旧。
   * 这条口子不接，扩写就是开了没人用的死口子。
   */
  function expandedQuery(q) {
    const text = String(q || '').trim()
    if (!text) return null
    // 已经是扩写过的串（含空白分隔的多个词）就不要再扩一次——
    // 海马体 recall 内部会回调 pf.plan，用扩写串再进来会拼两遍（上一版就是这么重的）。
    if (/\s/.test(text)) return null
    try {
      const cortex = probeNow().organs.cortex
      if (!cortex) return null
      const out = cortex.expand?.(text)
      if (typeof out !== 'string') return null
      const extra = out.trim()
      if (!extra || extra === text) return null
      telemetry.inc('expand')
      return extra
    } catch (e) {
      life.note(e)
      return null
    }
  }

  function planOf(query, opts = {}) {
    if (opts && opts.session) runtime.lastSessionId = String(opts.session)
    ensureTidyFresh('plan')
    telemetry.inc('plan')
    // 跨带缓存（T3→T0 的落点）：同一问句同一过滤条件，一轮内不重复算
    const key = telemetry.keyOf('plan', opts.filters || {}, [String(query)])
    const hit = telemetry.get(key)
    if (hit) return hit
    const p = makePlan(query, { ...baseCtx(opts.session), ...opts, expanded: expandedQuery(query) })
    telemetry.set(key, p, 10 * 60 * 1000)
    return p
  }

  function judgeOf(cands, opts = {}) {
    ensureTidyFresh('judge')
    telemetry.inc('judge')
    const r = runJudge(cands, {
      ...baseCtx(opts.session),
      plan: opts.plan || makePlan(opts.query || '', { session: opts.session }),
      coverage: opts.coverage || 0,
      topicDirection: opts.topicDirection,
      justSwitched: opts.justSwitched,
      goal: opts.goal,
      seams: seamsNow(),
    })
    telemetry.inc('kept', r.verdicts.length)
    telemetry.inc('suppressed', r.suppressed.length)
    // 冲突对必须落库。以前只在 judge 内部算完就丢，队列文件从来没生成过，
    // dispatch/adjudicate 每 2 分钟空转，stats 永远是 total:0。
    // 工作记忆 = 本轮真的在权衡的条目。放在 judge 出口：
    // 海马体走的是 plan → judge → verify，从不调 retrieve，
    // 以前刷新只挂在 retrieve 上，于是真实会话的热区永远不更新。
    {
      const sidJudge = opts.session || runtime.lastSessionId || ''
      if (sidJudge && cands.length) void hot.refresh(sidJudge, cands, { now: Date.now() })
    }
    if (Array.isArray(r.conflicts) && r.conflicts.length) {
      void conflicts.enqueue(r.conflicts).catch((e) => life.note?.(e))
    }
    return r
  }

  function gateOf(text, opts = {}) {
    telemetry.inc('gate')
    const g = shouldRemember(text, { ...baseCtx(opts.session), role: opts.role, rules: opts.rules })
    // P2-12：gate 也要留痕，否则账本永远是空的（P2-5 说的就是这条）
    void ledger.verdict({
      kind: 'gate',
      query: String(text || '').slice(0, 80),
      keep: g.keep,
      depth: g.depth,
      reason: g.reason,
    }).catch?.(() => {})
    return g
  }

  /**
   * 海马体契约里的两个钩子（encode.js / recall.js 在调）。
   * 名字必须严格对齐，否则它拿不到 —— optional chaining 会让缺失静默变成"没接"。
   */
  function shouldRememberOf(text, opts = {}) {
    return Boolean(gateOf(text, { session: opts.session, role: opts.role, rules: opts.rules }).keep)
  }

  /** 海马把补全结果推过来校验；它是 fire-and-forget，所以这里必须不阻塞、不抛。 */
  function verifyOf(cands, opts = {}) {
    try {
      const r = judgeOf(cands, {
        session: opts.session || 'haima',
        query: opts.query || '',
        coverage: opts.coverage || 0,
        plan: opts.plan,
      })
      return {
        ok: true,
        kept: r.verdicts.length,
        suppressed: r.suppressed.length,
        lowConfidence: r.flags.includes('no-assert') || (r.verdicts[0]?.confidence ?? 1) < 0.45,
        constraint: r.constraint,
        flags: r.flags,
        // 把 relevance / rankScore / summary 一起交出去：
        // 皮层要用它们排序和拼 answer，只给 id+rank 它就只能按插入顺序排（P2-2 的根因）。
        verdicts: r.verdicts.map((v) => ({
          id: v.id,
          rank: v.rank,
          confidence: v.confidence,
          flags: v.flags,
          relevance: v.relevance,
          rankScore: v.rankScore,
          summary: v.summary,
        })),
      }
    } catch (e) {
      life.note(e)
      return { ok: false, error: String(e?.message || e) }
    }
  }

  // ── 注入块 ────────────────────────────────────────────────
  function composeContext(session) {
    const t = tasks.current(session)
    const items = hot.tiers(session).hot
    const lastVerdict = ledger.projection(1).recent[0]
    const block = injectHost.compose({
      task: t ? { goal: t.goal, rules: t.rules } : null,
      constraint: lastVerdict && lastVerdict.conf < 0.45 ? { text: '上一轮我不太确定，别当事实用' } : null,
      fok: lastVerdict ? (lastVerdict.flags || []).find((f) => ['suppressed', 'tip-of-tongue'].includes(f)) : null,
      hot: items.map((i) => ({ summary: i.summary, tier: i.tier, source: null, confidence: null })),
      maxChars: 900,
    })
    return block.text
  }

  function refreshContext(session) {
    runtime.contextCache.set(session, composeContext(session))
  }

  // ── 工具 ──────────────────────────────────────────────────
  const tools = [
    makeTool('prefrontal_recall', '用前额叶的方式找记忆：先定计划再检索，返回排序过的结果 + 置信 + 来源 + 被压掉的。', {
      query: { type: 'string' },
      k: { type: 'integer', minimum: 1, maximum: 10, default: 5 },
      profile: { type: 'string', enum: ['fast', 'slow'], default: 'slow' },
    }, ['query'], async (args, exec) => retrieve(args.query, {
      session: exec?.agent?.id || 'manual',
      profile: args.profile || 'slow',
      budget: { items: args.k || 5 },
    })),
    makeTool('prefrontal_plan', '只出检索计划：意图、模式、过滤、目标、为什么。不检索。', {
      query: { type: 'string' },
    }, ['query'], async (args, exec) => ({ ok: true, ...planOf(args.query, { session: exec?.agent?.id }) })),
    makeTool('prefrontal_judge', '拿一批候选来判：留谁、排第几、多可信、和谁冲突、为什么。', {
      candidates: { type: 'array' },
      query: { type: 'string' },
    }, ['candidates'], async (args, exec) => {
      const r = judgeOf(args.candidates, { session: exec?.agent?.id, query: args.query || '' })
      const inv = invariant(r, (args.candidates || []).map((c) => c.summary))
      return { ok: true, ...r, invariant: inv }
    }),
    makeTool('prefrontal_gate', '这条值不值得记：噪声/草稿/违反约束的拦掉，其余给深度。', {
      text: { type: 'string' },
      role: { type: 'string', enum: ['user', 'assistant'] },
    }, ['text'], async (args, exec) => gateOf(args.text, { session: exec?.agent?.id, role: args.role || 'user' })),
    makeTool('prefrontal_task', '任务栈：看现在在干什么 / 加一个 / 结掉一个。', {
      action: { type: 'string', enum: ['list', 'push', 'pop', 'expire'] },
      goal: { type: 'string' },
      text: { type: 'string' },
    }, [], async (args, exec) => {
      const session = String(exec?.agent?.id || 'manual')
      if (args.action === 'push') return { ok: true, row: await tasks.push({ session, goal: args.goal }) }
      if (args.action === 'pop') {
        const cur = tasks.current(session)
        return cur ? tasks.pop(cur.id, { text: args.text || '' }) : { ok: false, why: '没有开着的任务' }
      }
      if (args.action === 'expire') return { ok: true, ...(await tasks.expire()) }
      return { ok: true, open: await tasks.list(session, { open: true }) }
    }),
    makeTool('prefrontal_stats', '前额叶现状：热区、账本、冲突队列、能力探测、telemetry。', {}, [], async () => ({
      ok: true,
      version: VERSION,
      // 清理/心跳证据：跑没跑、最后跑完哪一步、哪一步超时
      tidy: {
        lastOk: runtime.lastTidyOk || null,
        lastTimeout: runtime.lastTidyTimeout || null,
        lastError: runtime.lastTidyError || null,
        last: runtime.lastTidy || null,
      },
      seams: explainSeams(probeNow()),
      // 以前写死 hot.tiers('default')：数据都挂在真实 session 下，
      // 于是 /stats 永远显示"工作记忆是空的"，其实别的会话里有内容。
      hot: (() => {
        const ids = hot.sessionIds()
        const latest = hot.latestSession()
        const summary = ids.map((id) => {
          const t = hot.tiers(id)
          return { id, hot: t.hot?.length || 0, recent: t.recent?.length || 0, background: t.background?.length || 0, updatedAt: t.updatedAt || 0 }
        })
        return { latest, sessions: summary, ...(latest ? hot.tiers(latest) : { hot: [], recent: [], background: [] }) }
      })(),
      ledger: ledger.stats(),
      conflicts: conflicts.stats(),
      telemetry: telemetry.snapshot(),
      life: life.check(),
      calibration: runtime.calibration,
    })),
    makeTool('prefrontal_ledger', '只读账本：最近判了什么、压了谁、哪些策略被拉黑。', {}, [], async () => ({
      ok: true,
      ...ledger.projection(20),
    })),
    makeTool('prefrontal_conflicts', '冲突队列：有哪些待裁、什么时候到期、谁负责。', {}, [], async () => ({
      ok: true,
      open: conflicts.open(20),
      stats: conflicts.stats(),
    })),
    makeTool('prefrontal_priority', '巩固优先级：告诉海马先重放哪几条。', {
      candidates: { type: 'array' },
      goal: { type: 'string' },
    }, ['candidates'], async (args) => ({
      ok: true,
      ranked: hint.rankForConsolidation(args.candidates || [], { goal: args.goal, now: Date.now() }),
      note: hint.explainPriority(hint.rankForConsolidation(args.candidates || [], { goal: args.goal })),
    })),
    makeTool('prefrontal_feedback', '用户说“不对/不是”时调用：下调同类意图的置信，并记一笔。', {
      intent: { type: 'string' },
      correct: { type: 'boolean' },
    }, [], async (args) => {
      const intent = args.intent || 'episode'
      runtime.calibration = args.correct === false
        ? meta.onDeny(runtime.calibration, intent)
        : meta.onOk(runtime.calibration, intent)
      await writeJson(FILES.calibration, runtime.calibration)
      return { ok: true, intent, calibration: runtime.calibration }
    }),
  ]

  // ── 工作集压缩（记忆器官专用）──────────────────────────────
  // 归前额叶：它本来就在决定"留什么、压掉谁"。
  // 不是通用摘要：压掉的只是进上下文的字，细节还在海马体原话里，靠指针回取。
  runtime.workset = runtime.workset || new Map()
  runtime.worksetAt = runtime.worksetAt || new Map()

  async function refreshWorkset(session) {
    try {
      const hip = (() => { try { return ctx.get?.('memory.hippocampus') ?? null } catch { return null } })()
      if (!hip?.episodes) return
      const eps = await hip.episodes({ limit: 40 })
      const rows = Array.isArray(eps) ? eps : (eps?.episodes || eps?.rows || [])
      if (!rows.length) return
      const turns = rows
        .slice()
        .sort((a, b) => Number(a.start ?? a.at ?? 0) - Number(b.start ?? b.at ?? 0))
        .map((e) => ({
          role: e.brief ? 'assistant' : 'user',
          text: String(e.summary || e.brief || ''),
          at: Number(e.start ?? e.at ?? 0),
          episodeId: String(e.id || e.episodeId || ''),
          salience: Number(e.confidence ?? 0.5) * 0.6 + (Number(e.valence) ? 0.2 : 0),
        }))
      const set = buildWorkingSet(turns, { budgetTokens: 900 })
      runtime.workset.set(session, set.text)
      runtime.worksetAt.set(session, Date.now())
      runtime.lastWorkset = { at: Date.now(), tokens: set.tokens, pointers: set.kept.pointers.length, turns: set.turns }
    } catch (e) {
      runtime.lastError = 'workset:' + String(e?.message || e)
      if (process.env.DSH_WORKSET_DEBUG) console.error('[workset]', e?.message || e)
    }
  }

  // ── 挂载 Agent ────────────────────────────────────────────
  function mount(agent) {
    if (!agent?.ctx || !agent.id || runtime.mounted.has(agent.id)) return
    const session = String(agent.id)
    runtime.mounted.add(session)
    // 上下文预热失败不能把整个 mount 带走：以前它一抛，下面的两块注入都注册不上，
    // 外面还是静默 catch，结果就是"前额叶等于没挂上"。
    try { refreshContext(session) } catch (e) { runtime.lastError = 'refreshContext:' + String(e?.message || e) }

    // 注入开关：config.json 的 inject.prefrontal === false 时，不往 system prompt 写（工具照常可用）
    if (globalThis.__DSH_ALL_INJECT__?.prefrontal !== false) {
      try {
        const dispose = agent.ctx.systemPrompt.context({
          name: 'prefrontal-usage',
          order: 930,
          required: false,
          interpolate: false,
          text: () => runtime.contextCache.get(session) || composeContext(session),
        })
        agent.ctx.effect?.(dispose)
      } catch (e) {
        runtime.lastError = String(e?.message || e)
      }

    }

    // 第二块：工作集压缩（给记忆器官用的那份）。
    // 单独一个开关：config 里 inject.prefrontal=false 只是关掉"用法提示"，
    // 压缩是记忆器官的功能，不该被那个开关连坐。
    if (globalThis.__DSH_ALL_INJECT__?.workset !== false) {
      try {
        const dispose = agent.ctx.systemPrompt.context({
          name: 'memory-workset',
          order: 929,
          required: false,
          interpolate: false,
          text: () => runtime.workset.get(session) || '',
        })
        agent.ctx.effect?.(dispose)
        void refreshWorkset(session)
        const t = setInterval(() => { void refreshWorkset(session) }, 60_000)
        if (typeof t.unref === 'function') t.unref()
        agent.ctx.effect?.(() => clearInterval(t))
      } catch (e) {
        runtime.lastError = 'workset:' + String(e?.message || e)
      }
    }

    const offInbox = agent.ctx.on('agent/inbox/inserted', async ({ message } = {}) => {
      try {
        const text = message?.content ?? message?.text ?? ''
        if (!text) return
        // 只抽约束，不写记忆（写是海马的活）
        await tasks.absorbConstraint(session, String(text))
        const t = tasks.current(session)
        // P3-10：跑题计数要在这里累加，否则这条功能是死的
        const d = injectHost.drift(runtime.drift.get(session) || {}, { task: t, text: String(text), now: Date.now() })
        runtime.drift.set(session, d.state)
        if (d.pull) runtime.pulledAt = Date.now()
        if (d.pull || d.state.off === 0) refreshContext(session)
        void refreshWorkset(session)
      } catch (e) {
        runtime.lastError = String(e?.message || e)
      }
    })

    const offStop = agent.ctx.on('agent/turn-stopping', async () => {
      try {
        // P0-4：换任务才清背景档；同一任务不折腾
        const now = Date.now()
        const lastIntent = runtime.lastIntent.get(session)
        const cur = tasks.current(session)
        const justSwitched = Boolean(lastIntent && runtime.lastTurn.get(session) > 1 && lastIntent !== cur?.intent)
        await hot.dropOnSwitch(session, { justSwitched, keepTaskId: cur?.id, now })
        await hot.refresh(session, [], { now })
        await tasks.expire()
        await ledger.sweep()
        await conflicts.dispatch(now, { cortex: Boolean(probeNow().organs.cortex?.contradicts) })
        await telemetry.flush()
        refreshContext(session)
      } catch (e) {
        runtime.lastError = String(e?.message || e)
      }
    })

    agent.ctx.effect?.(() => {
      offInbox?.()
      offStop?.()
      runtime.mounted.delete(session)
    })
  }

  // 只读路由：把最近一次压缩结果摊开，省得只能靠猜。
  try {
    ctx.webServer?.register?.({
      path: '/memory/workset',
      handler: async (req, res) => {
        try {
          const url = new URL(String(req?.url || '/memory/workset'), 'http://local')
          const session = url.searchParams.get('session') || ''
          const keys = [...runtime.workset.keys()]
          const pick = session && runtime.workset.has(session) ? session : keys[keys.length - 1]
          res.statusCode = 200
          res.setHeader('content-type', 'application/json; charset=utf-8')
          res.end(JSON.stringify({
            ok: true,
            sessions: keys.length,
            session: pick || null,
            use: typeof req?.query?.use === 'string' ? req.query.use : (url.searchParams.get('use') || 'prompt'),
            text: pick ? runtime.workset.get(pick) : '',
            last: runtime.lastWorkset || null,
            lastError: runtime.lastError || null,
            at: Date.now(),
          }))
        } catch (e) {
          res.statusCode = 500
          res.end(JSON.stringify({ ok: false, error: String(e?.message || e) }))
        }
      },
    })
  } catch { /* 没有 webServer 就算了 */ }

  try {
    for (const agent of svc('agents')?.list?.() || []) mount(agent)
  } catch { /* 列不出来就等 created */ }
  try {
    ctx.effect?.(ctx.on('agent/created', ({ agent }) => { try { mount(agent) } catch { /* 单个失败不拖累 */ } }))
  } catch { /* 没有事件系统就靠轮询 */ }

  const poll = setInterval(() => {
    try {
      for (const agent of svc('agents')?.list?.() || []) if (!runtime.mounted.has(String(agent?.id))) mount(agent)
    } catch { /* 下一轮再说 */ }
  }, 4000)
  poll.unref?.()
  ctx.effect?.(() => clearInterval(poll))

  // 定期：清账、过期任务、派冲突、算消退曲线
  // 每步都要有超时：任何一步 await 卡住，整轮 tidy 就不再回来，
  // 心跳停在 >10 分钟就报 stale（实测过 stale:true 而文件没更新）。
  const tidyStep = async (name, fn, ms = 3000) => {
    const t = Date.now()
    try {
      const r = await Promise.race([
        Promise.resolve().then(fn),
        new Promise((resolve) => setTimeout(() => resolve(Symbol.for('tidy-timeout')), ms)),
      ])
      if (r === Symbol.for('tidy-timeout')) {
        runtime.lastTidyTimeout = { step: name, at: Date.now(), ms }
        return null
      }
      runtime.lastTidyOk = { step: name, at: Date.now(), took: Date.now() - t }
      return r
    } catch (e) {
      runtime.lastTidyError = { step: name, at: Date.now(), error: String(e?.message || e) }
      return null
    }
  }

  // 宿主会节流/挂起定时器（实测：进程活着，但 60s 和 120s 两个 interval 在 ~6 分钟后都不再触发）。
  // 所以清理不能只靠定时器：任一次工具调用都会顺手补一次（60 秒内不重复）。
  let tidyInFlight = false
  let tidyLastAt = 0
  async function runTidyNow(why = 'timer') {
    const cortexReady = Boolean(probeNow().organs.cortex?.contradicts)
    await tidyStep('tasks.expire', () => tasks.expire())
    await tidyStep('ledger.sweep', () => ledger.sweep())
    await tidyStep('conflicts.dispatch', () => conflicts.dispatch(Date.now(), { cortex: cortexReady }))
    await tidyStep('adjudicate', () => Promise.resolve(adjudicateOpen()))
    runtime.decayed = (await tidyStep('decay', () => Promise.resolve(sweepDecay()))) ?? runtime.decayed
    await tidyStep('telemetry.flush', () => telemetry.flush())
    tidyLastAt = Date.now()
    runtime.lastTidy = { at: tidyLastAt, why }
    life.beat()
  }

  /** 惰性补跑：工具/服务被调用时顺手把过期清理做掉。 */
  function ensureTidyFresh(why = 'call') {
    if (tidyInFlight) return
    if (Date.now() - tidyLastAt < 60 * 1000) return
    tidyInFlight = true
    void life.guardAsync(() => runTidyNow(why))
      .catch(() => null)
      .finally(() => { tidyInFlight = false })
  }

  const tidy = setInterval(() => {
    if (tidyInFlight) return
    tidyInFlight = true
    void life.guardAsync(() => runTidyNow('timer'))
      .catch(() => null)
      .finally(() => { tidyInFlight = false })
  }, 2 * 60 * 1000)

  /**
   * P2-6 冲突裁决：把队列里开着的争议按"时间>来源>重复"排一次。
   * 三规则一致才敢定案（conflict.adjudicate 自己管这个），定完回填队列。
   * 没有裁决人（皮层不在）时只记账，不假装解决。
   */
  function adjudicateOpen() {
    try {
      const open = conflicts.open(20)
      if (!open.length) return 0
      const byId = (id) => {
        const row = ledger.projection(50).recent.find((r) => (r.hits || []).includes(id))
        return row ? { at: row.at, source: { trust: 0.5 }, repeat: 1 } : null
      }
      let n = 0
      for (const p of open) {
        const v = conflictKernel.adjudicate(p, { byId })
        if (!v.decided) continue
        n += 1
        void conflicts.resolve(p.key, v.winner ? `auto:${v.winner}` : 'auto:weak')
      }
      return n
    } catch {
      return 0
    }
  }

  /** 消退：只对"被压过"的条目算曲线；有杏仁核才真发请求，没有就只算不写（不假装成功）。 */
  function sweepDecay() {
    try {
      const rows = (ledger.projection(50).suppressed || []).slice(-5)
      let n = 0
      for (const r of rows) {
        const gate = decay.shouldRequest(Number(r.weight ?? 1), r.at, Date.now())
        if (!gate.send) continue
        const c = decay.curve(Number(r.weight ?? 1), 0.2)
        if (!c.length) continue
        n += 1
        if (probeNow().organs.amygdala?.adjust) {
          amyAdjust(seamsNow(), r.id, { delta: c[0].delta, curve: c.length, reason: '消退' })
        }
      }
      return n
    } catch {
      return 0
    }
  }
  tidy.unref?.()
  ctx.effect?.(() => clearInterval(tidy))

  // ── 对外服务 & 面板 ───────────────────────────────────────
  const api = {
    version: VERSION,
    // 海马体契约的三个钩子（名字严格对齐，缺一个它就静默当没接）
    plan: planOf,
    shouldRemember: shouldRememberOf,
    verify: verifyOf,
    judge: judgeOf,
    gate: gateOf,
    retrieve,
    context: (session) => runtime.contextCache.get(session) || composeContext(session),
    priority: (cands, opts) => hint.rankForConsolidation(cands, { goal: opts?.goal, now: Date.now() }),
    hint: (plan, suppressed) => hint.hint(plan, suppressed),
    hello: () => probeNow().hello,
    seams: () => explainSeams(probeNow()),
    capabilities: () => caps(),
    stats: async () => ({
      version: VERSION,
      tidy: {
        lastOk: runtime.lastTidyOk || null,
        lastTimeout: runtime.lastTidyTimeout || null,
        lastError: runtime.lastTidyError || null,
      },
      seams: explainSeams(probeNow()),
      ledger: ledger.stats(),
      conflicts: conflicts.stats(),
      telemetry: telemetry.snapshot(),
      life: life.snapshot(),
      decayed: runtime.decayed,
      capabilityKeys: probeNow().capabilities._keys,
      confidenceWeights: score.WEIGHTS,
      target: 'F1–F17 见 README',
    }),
    shadow,
    feedback: (intent, correct) => {
      runtime.calibration = correct ? meta.onOk(runtime.calibration, intent) : meta.onDeny(runtime.calibration, intent)
      return runtime.calibration
    },
    invariants: { noContent: invariant },
  }

  try { ctx.provide?.('memory.prefrontal', api) } catch { /* 老版本没有 provide */ }
  try { ctx.set?.('memory.prefrontal', api) } catch { /* 同上 */ }

  for (const tool of tools) {
    try {
      const toolsSvc = svc('tools')
      if (toolsSvc?.get?.(tool.name)) continue
      toolsSvc?.register?.(tool)
    } catch (e) {
      console.error(`[${NAME}] tool register failed:`, tool.name, e?.message || e)
    }
  }

  try {
    const ws = svc('webServer')
    if (ws?.register) {
      ws.register({ kind: 'exact', path: '/prefrontal/state', handler: async (_req, res) => sendJson(res, await api.stats()) })
      ws.register({
        kind: 'exact',
        path: '/prefrontal/plan',
        handler: async (req, res) => {
          const q = new URL(req.url, 'http://x').searchParams.get('q') || ''
          sendJson(res, planOf(q))
        },
      })
      ws.register({
        kind: 'exact',
        path: '/prefrontal/recall',
        handler: async (req, res) => {
          const q = new URL(req.url, 'http://x').searchParams.get('q') || ''
          sendJson(res, await retrieve(q))
        },
      })
    }
  } catch { /* 没有 webServer 就当纯逻辑插件 */ }

  void (async () => {
    try {
      await migrate.migrate()
      await hot.load()
      await tasks.load()
      await ledger.load()
      await conflicts.load()
      runtime.calibration = (await readJson(FILES.calibration, null)) || {}
      await telemetry.load()
      for (const sid of runtime.mounted) refreshContext(sid)
      life.beat()
      await tasks.expire()
      await ledger.sweep()
    } catch (e) {
      runtime.lastError = String(e?.message || e)
      life.note(e)
    }
  })()

  return () => { /* 定时器由 effect 清掉 */ }
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
      try {
        const out = await handler(args || {}, exec || {})
        return { content: [{ type: 'text', text: JSON.stringify(out ?? {}, null, 2) }] }
      } catch (e) {
        telemetry.inc('errors')
        life.note(e)
        return { content: [{ type: 'text', text: JSON.stringify({ ok: false, error: String(e?.message || e) }) }] }
      }
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

export const _internal = { absent, flags, cap }
