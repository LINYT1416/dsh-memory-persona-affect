import fs from 'node:fs'
// dsh-persona 入口：挂时钟、读盘、注入、工具、服务。
//
// 六器官同帧：A 段习惯匹配 → B 段读人/定价/检错/归我/连故事/固化。
// 对外两个方向：读心情与记忆（不写），把参数回写给心情（配置写，不碰状态）。

import { join, dirname } from 'node:path'
import { homedir } from 'node:os'

import { createEngine, TICK_MS, setUserBias } from './core/engine.js'
import { createStore } from './core/store.js'
import { describe, dump } from './core/desc.js'
import { selfBias, selfHints } from './core/style.js'
import { looksBias } from './core/looks.js'
import { createAffectBridge } from './bridge/affect.js'
import { createMemoryBridge } from './bridge/memory.js'
import { pickRecall, loadUsed, saveUsed, isRecallDue } from './core/remember.js'
import { createRelation } from './core/relation.js'
import { detectConflicts, createConflictLog } from './core/audit.js'
import { createGoals } from './core/goal.js'
import { decideSpeak } from './core/speak.js'
import { speechBudget } from './core/budget.js'
import { readAir } from './core/air.js'
import { decideAvoid } from './core/avoid.js'
import { rationalize } from './core/deceive.js'
import { observeSelf } from './core/aware.js'
import { leak } from './core/leak.js'
import { project } from './core/project.js'
import { attribute } from './core/blame.js'
import { suppress } from './core/suppress.js'
import { sublimate } from './core/sublimate.js'
import { idealGap } from './core/ideal.js'
import { createHabit } from './core/habit.js'
import { unclearState } from './core/unclear.js'
import { roleOf } from './core/role.js'
import { denyFear } from './core/deny.js'
import { createKeyPeriod } from './core/keyperiod.js'
import { opaqueMotive } from './core/motive.js'
import { posture } from './core/posture.js'
import { humor } from './core/humor.js'
import { resilience, recover } from './core/resilience.js'
import { contagion } from './core/contagion.js'
import { createRitual } from './core/ritual.js'
import { rhythm } from './core/rhythm.js'
import { lexicon, BANNED_LIST } from './core/lexicon.js'
import { createConsistency } from './core/consistency.js'
import { loadIdentity } from './core/identity.js'
import { createSpeakers } from './core/speakers.js'
import { privacy } from './core/privacy.js'
import { createReciprocity } from './core/reciprocity.js'
import { createMajorEvent } from './core/major-event.js'
import { createOstracism } from './core/ostracism.js'
import { boundaryOf } from './core/boundary.js'
import { maintain } from './core/maintenance.js'
import { fuse } from './core/integrate.js'
import { socialEmotion } from './core/social-emotion.js'
import { createLegacy } from './core/legacy.js'
import { decideRepair } from './core/repair.js'
import { bottomLine, normCheck } from './core/values.js'
import { expressionRule } from './core/expression.js'
import { explainStyle, nostalgia } from './core/explain.js'
import { empathy } from './core/empathy.js'
import { mindread } from './core/mindread.js'
import { retire } from './core/degrade.js'
import { degrade } from './core/degrade.js'
import { loadStoryline, pickStoryline } from './core/storyline.js'
import { loadInterlocutor, answerWho } from './core/interlocutor.js'
import { biography } from './core/autobio.js'
import { createWorth } from './core/worth.js'
import { createCrave } from './core/crave.js'
import { efficacyOf } from './core/efficacy.js'
import { createPossess } from './core/possess.js'
import { createCuteState } from './core/cute.js'
import { createPanel } from './panel.js'

export const name = 'dsh-persona'
// webServer 必须声明：不声明的话 apply 里拿不到 ctx.webServer，
// 面板的路由会被静默吞掉（页面 404，日志里还什么都不报）。
export const inject = ['systemPrompt', 'tools', 'webServer']
export const VERSION = '2.0.0'

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v)

export function apply(ctx, config = {}) {
  const home = process.env.DSH_HOME || join(homedir(), '.dsh')
  const store = createStore(home)

  const get = (id) => {
    try { return ctx.get?.(id) ?? null } catch { return null }
  }

  const affect = createAffectBridge(get)
  const memory = createMemoryBridge(get)
  const bridge = {
    affect: () => affect.state(),
    episodes: () => memory.episodes(),
  }

  const engine = createEngine({
    config,
    bridge,
    emit: (n, p) => { try { ctx.emit?.(n, p) } catch { /* 没人听 */ } },
  })

  // 关系账本：谁帮过谁、熟到哪一档。读盘失败就当新账本，不伪造历史。
  const relationFile = join(home, 'persona', 'relation.json')
  let relationSeed = {}
  try { relationSeed = JSON.parse(fs.readFileSync(relationFile, 'utf8')) || {} } catch { relationSeed = {} }
  const relation = createRelation(relationSeed)

  // S10 冲突自检：读数互相打架时进队列（不硬解释，留给复核）
  const conflictLog = createConflictLog(join(home, 'persona', 'conflicts.json'))

  // M11 目标结果：她说要做的事，成了 / 黄了 / 还悬着
  const goalsFile = join(home, 'persona', 'goals.json')
  const goals = createGoals()

  // R06 嫉妒与占有 / X11 撒娇：都要落盘，重启别把"在乎"清零
  const possessFile = join(home, 'persona', 'possess.json')
  const possess = createPossess()
  try { possess.restore(JSON.parse(fs.readFileSync(possessFile, 'utf8'))) } catch { /* 第一次没有 */ }
  const cuteFile = join(home, 'persona', 'cute.json')
  const cute = createCuteState()
  const craveFile = join(home, 'persona', 'crave.json')
  const crave = createCrave()
  const worthFile = join(home, 'persona', 'worth.json')
  const worth = createWorth()
  const habitFile = join(home, 'persona', 'habit.json')
  const habit = createHabit()
  const keyFile = join(home, 'persona', 'keyperiod.json')
  const keyPeriod = createKeyPeriod()
  const ritualFile = join(home, 'persona', 'ritual.json')
  const ritual = createRitual()
  const consistencyFile = join(home, 'persona', 'consistency.json')
  const consistency = createConsistency()
  const reciprocityFile = join(home, 'persona', 'reciprocity.json')
  const reciprocity = createReciprocity()
  try { reciprocity.restore(JSON.parse(fs.readFileSync(reciprocityFile, 'utf8'))) } catch { /* first run */ }
  const majorEventFile = join(home, 'persona', 'major-event.json')
  const majorEvent = createMajorEvent()
  const repairFile = join(home, 'persona', 'repair.json')
  let repairState = { lastApologizedAt: 0, pendingRepair: false }
  try { repairState = { ...repairState, ...JSON.parse(fs.readFileSync(repairFile, 'utf8')) } } catch { /* first run */ }
  const legacyFile = join(home, 'persona', 'legacy.json')
  const legacy = createLegacy()
  try { legacy.restore(JSON.parse(fs.readFileSync(legacyFile, 'utf8'))) } catch { /* first run */ }
  const ostracismFile = join(home, 'persona', 'ostracism.json')
  const ostracism = createOstracism()
  try { ostracism.restore(JSON.parse(fs.readFileSync(ostracismFile, 'utf8'))) } catch { /* first run */ }
  try { majorEvent.restore(JSON.parse(fs.readFileSync(majorEventFile, 'utf8'))) } catch { /* first run */ }
  const identityFile = join(home, 'persona', 'identity.json')
  let identity = loadIdentity(identityFile)
  const storyFile = join(home, 'persona', 'storyline.json')
  let storyline = loadStoryline(storyFile)
  const whoFile = join(home, 'persona', 'interlocutor.json')
  let interlocutor = loadInterlocutor(whoFile)
  const speakersFile = join(home, 'persona', 'speakers.json')
  const speakers = createSpeakers()
  try { speakers.restore(JSON.parse(fs.readFileSync(speakersFile, 'utf8'))) } catch { /* first run */ }
  try { consistency.restore(JSON.parse(fs.readFileSync(consistencyFile, 'utf8'))) } catch { /* first run */ }
  let lastPending = new Set()
  try { ritual.restore(JSON.parse(fs.readFileSync(ritualFile, 'utf8'))) } catch { /* first run */ }
  try { keyPeriod.restore(JSON.parse(fs.readFileSync(keyFile, 'utf8'))) } catch { /* first run */ }
  try { habit.restore(JSON.parse(fs.readFileSync(habitFile, 'utf8'))) } catch { /* first run */ }
  // 她自己的日常事：反复做才叫习惯
  const CUE_RE = /(咖啡|奶茶|跑步|夜跑|刷手机|刷视频|熬夜|运动)/
  try { worth.restore(JSON.parse(fs.readFileSync(worthFile, 'utf8'))) } catch { /* first run */ }
  try { crave.restore(JSON.parse(fs.readFileSync(craveFile, 'utf8'))) } catch { /* first run */ }
  try { cute.restore(JSON.parse(fs.readFileSync(cuteFile, 'utf8'))) } catch { /* 第一次没有 */ }
  try { goals.restore(JSON.parse(fs.readFileSync(goalsFile, 'utf8'))) } catch { /* 第一次没有 */ }

  const runtime = { loaded: false, lastError: null, ticks: 0, lastRefresh: 0, lastBeat: null }

  // 人格面板：模式（自定义+学习 / 纯学习）、手写自述、三个旋钮
  const panel = createPanel({
    home, engine, clamp,
    // 旋钮的落点是心情：配置写，不碰状态
    setPersona: (patch) => affect.retune({ persona: patch }),
    // 自我草稿要的"经历"：只读缓存，不阻塞、不编
    episodes: () => { try { return memory.episodes() || [] } catch { return [] } },
    // 缓存没刷新时，草稿这里主动拉一次（否则面板会误报"没有经历"）
    refreshEpisodes: () => memory.refresh(10),
    // 语气样本：她自己的原话（记忆里的 assistant 发言），取不到就空着走默认
    styleSamples: () => memory.assistantSamples?.(12) ?? [],
    // 面板要看的心情侧读数（句长/延迟/表情包倾向）：人格自己不算这些
    readAffect: () => affect.state(),
    // 关系账本：仪表页要能看到欠不欠人情、熟到什么程度
    relation: () => relation.snapshot(),
    // 冲突队列条数：仪表页能看到状态打架了几次
    conflicts: () => { try { return conflictLog.count() } catch { return 0 } },
    goals: () => goals.snapshot(),
    possess: () => possess.snapshot(),
    crave: () => crave.snapshot(),
    worth: () => worth.snapshot(),
    habit: () => habit.snapshot(),
    keyPeriod: () => keyPeriod.snapshot(),
    ritual: () => ritual.snapshot(),
    consistency: () => consistency.snapshot(),
    identity: () => ({ filled: identity.filled, facts: identity.facts }),
    speakers: () => speakers.snapshot(),
    storyline: () => ({ filled: storyline.filled, points: storyline.turningPoints.length }),
    interlocutor: () => ({ filled: interlocutor.filled, name: interlocutor.name }),
    reciprocity: () => reciprocity.snapshot(),
    majorEvent: () => majorEvent.snapshot(),
    ostracism: () => ostracism.snapshot(),
    legacy: () => legacy.snapshot(),
    boundary: () => boundaryOf(relation.snapshot()),
    repair: () => ({ ...repairState }),
    maintenance: () => runtime.lastMaint || null,
    integrated: () => runtime.integrated || null,
    // D07：退役的习惯（页面能看见）
    retired: () => runtime.retiredCues || [],
  })
  // 路由注册失败要留痕：以前这里静默 catch，页面 404 还查不出原因。
  if (!ctx.webServer) {
    runtime.lastError = 'panel:no-webServer（inject 里没声明 webServer）'
  } else {
    try { panel.register(ctx) } catch (e) { runtime.lastError = 'panel:' + String(e?.message || e) }
  }
  panel.applyKnobs()
  let lastBusAt = 0

  // ── 人格 → 心情：只写配置 ──────────────────────────────
  function modulate() {
    const f = engine.read()
    if (!f) return null
    const h = f.hex
    const t = f.traits
    return {
      amygdala: {
        // 越固执越慢降，越能缓过来越快降
        tauThreat: 6 + 20 * clamp(t.stickiness, 0, 1),
      },
      pfc: {
        // 话越短，抑制越强
        suppressionBase: clamp(0.12 + 0.4 * h.brevity, 0.1, 0.6),
        leakGain: clamp(0.8 + 1.4 * h.blunt, 0.5, 3),
      },
      // 感受层：这三个不是"怎么说"，是"多疼"。
      // 只写上面两组的话，人格只能改语气，改不了心情——探针实测 mood/valence 三拍零变化。
      persona: {
        // 越放不下（固执/执着），同一件事扎得越深
        threatGain: clamp(0.8 + 0.5 * clamp(t.stickiness, 0, 1), 0.5, 2),
        // 越暖，越容易被人家的情绪带动
        sensitivity: clamp(0.85 + 0.35 * clamp(h.warmth ?? 0.6, 0, 1), 0.5, 2),
        // 自尊高一点，底色就往上抬一点（限幅 ±0.12，不许把人推走）
        baselineMood: clamp((clamp(t.esteem ?? 0.5, 0, 1) - 0.5) * 0.24, -0.12, 0.12),
      },
    }
  }


  // 人设一改，行为立刻跟着改：从自述里量出句长/语气词，转成偏置塞给引擎。
  // 这不是"主人叫我改我才改"，是每次保存自述都会自动重算。
  // 自述变了就重算偏置：不用人喊，下一拍就照新的人设说话
  function applySelfBias() {
    try {
      const st = panel && panel.state ? panel.state : null
      const text = st ? String(st.selfText || '') : ''
      const mode = st ? st.mode : 'custom'
      const sig = mode + '|' + text
      if (sig === runtime.lastSelfSig) return null
      runtime.lastSelfSig = sig
      if (mode !== 'custom') { setUserBias(null); return null }
      const b = selfBias(text, looksBias())
      setUserBias(b)
      return b
    } catch { return null }
  }

  function retune() {
    const cfg = modulate()
    if (!cfg) return { ok: false, reason: 'no-fused' }
    // 主人拖的三个旋钮是「基线之上的偏移」，不是把人格推断整个盖掉。
    // 以前这里 retune(cfg) 之后又 panel.applyKnobs() 覆盖一次，导致自定义模式下人格永远推不动心情。
    const p = panel && typeof panel.state === 'object' ? panel.state : null
    if (p && p.mode === 'custom' && p.knobs) {
      cfg.threatGain = clamp(Number(cfg.threatGain ?? 1) * Number(p.knobs.threatGain ?? 1), 0.5, 2)
      cfg.baselineMood = clamp(Number(cfg.baselineMood ?? 0) + Number(p.knobs.baselineMood ?? 0), -1, 1)
      cfg.sensitivity = clamp(Number(cfg.sensitivity ?? 1) * Number(p.knobs.sensitivity ?? 1), 0.5, 2)
    }
    const out = affect.retune(cfg)
    // 手写的旋钮优先级高于推断：每 60 拍会按证据重写一次 persona 三旋钮，
    // 不在这里补回来的话，主人在面板上拖的值会被学习悄悄盖掉。
    // 纯学习模式下 applyKnobs 自己什么都不做。
    return out
  }

  // ── 读盘 ────────────────────────────────────────────────
  const ready = store
    .load(() => engine.snapshot())
    .then((saved) => {
      if (saved && saved.schema === 2) engine.restore(saved)
      runtime.loaded = true
      retune()
      void store.save()
    })
    .catch((e) => {
      runtime.lastError = String(e?.message || e)
      runtime.loaded = true
    })

  // ── 一拍 ────────────────────────────────────────────────
  function tick(events = [], sid = '') {
    // 记住这一轮对方说的最后一句：注入时要"读空气"
    for (const e of events || []) {
      if (e && e.type === 'user' && e.text) { runtime.lastUserText = String(e.text).slice(0, 200); runtime.lastUserAt = Date.now() }
    }
    try {
      let touched = false
      for (const e of events || []) {
        if (!e || e.type !== 'user') continue
        relation.note(e.text, e.at || Date.now())
        touched = true
      }
      // 每轮都落盘：只存人情的账会在重启后把 turns/亲密度清零，等于没熟过
      if (touched) {
        try {
          // 新 profile 里 persona 目录还不存在，直接写会 ENOENT 被吞掉——账本永远落不了盘
          fs.mkdirSync(dirname(relationFile), { recursive: true })
          fs.writeFileSync(relationFile, JSON.stringify(relation.snapshot()), 'utf8')
        } catch { /* ignore */ }
      }
    } catch { /* ledger must never break the beat */ }
    if (!runtime.loaded) return null
    try {
      applySelfBias()
      const out = engine.tick(events, sid)
      runtime.ticks += 1
      void ready.then(() => {
        try { store.set(engine.snapshot()); void store.save() } catch { /* 存不下不影响跑 */ }
      })
      // 每 10 拍后台拉一次自传，不阻塞这一拍
      // P01：第一拍就先拉一次，别让"她的故事"开局空十分钟
      if (runtime.ticks <= 1 || runtime.ticks - runtime.lastRefresh >= 10) {
        runtime.lastRefresh = runtime.ticks
        void memory.refresh(8).catch(() => {})
      }
      if (runtime.ticks % 60 === 0) retune()
      // R12 对话者：入口给了 speakerId 才分人；没给就当熟人
      try {
        let newFace = false
        for (const e of events || []) {
          if (!e || e.type !== 'user') continue
          const r = speakers.note(e.speakerId, e.at || Date.now())
          if (r.firstTime) newFace = true
        }
        if (newFace) {
          const ln = speakers.line((events.find((e) => e && e.speakerId) || {}).speakerId)
          if (ln) runtime.newSpeakerLine = ln
          try {
            fs.mkdirSync(dirname(speakersFile), { recursive: true })
            fs.writeFileSync(speakersFile, JSON.stringify(speakers.snapshot()), 'utf8')
          } catch { /* ignore */ }
        }
      } catch { /* ignore */ }

      // S09 自我一致：她说过要做的，一天内撤了就得承认改主意
      try {
        const nowPending = new Set((goals.snapshot().pending || []).map((x) => String(x.text || '')))
        for (const t of lastPending) {
          if (t && !nowPending.has(t)) {
            const r = consistency.say('pending:' + t, '不做了', Date.now())
            if (r.changed && r.line) runtime.consistencyLine = r.line
          }
        }
        for (const t of nowPending) if (!lastPending.has(t)) consistency.say('pending:' + t, '要做', Date.now())
        lastPending = nowPending
        try {
          fs.mkdirSync(dirname(consistencyFile), { recursive: true })
          fs.writeFileSync(consistencyFile, JSON.stringify(consistency.snapshot()), 'utf8')
        } catch { /* ignore */ }
      } catch { /* ignore */ }

      // E08 共情·认知：对方在说"他以为/我觉得"时，先把他的意思接住
      try {
        const mr = mindread(runtime.lastUserText || '')
        if (mr.guessed && mr.belief) runtime.mindLine = mr.who === 'other' ? `你是说，他觉得${mr.belief}` : `你是说，你觉得${mr.belief}`
      } catch { /* ignore */ }

      // 三器一体：心情定底色、记忆给证据、人格定怎么处理
      try {
        const rd0 = (engine.read() || {})
        const pool = typeof memory.wide === 'function' ? (memory.wide(120) || []) : []
        // memory.wide() 给的是 {brief,valence,at,type}，不是 {text,kind}——字段要按它来
        const recall = pool.slice(0, 12).map((e) => ({
          text: String(e && (e.brief || e.summary || e.text) || ''),
          kind: String(e && (e.type || e.kind || e.mood) || ''),
          at: Number(e && (e.at || e.ts)) || 0,
          valence: Number.isFinite(Number(e && e.valence)) ? Number(e.valence) : null,
        })).filter((e) => e.text)
        // 心情器官没接上时（离线/降级），用读空气的粗判断兜底，别让联动哑掉
        let emos = Array.isArray(rd0.emotions) ? rd0.emotions : []
        if (!emos.length) {
          // 心情器官没接上：按这句话的冷热估一个，别让联动哑掉
          const cg0 = contagion(String(runtime.lastUserText || ''))
          const d0 = Number(cg0 && cg0.delta) || 0
          if (d0 < -0.05) emos = [{ kind: '委屈', intensity: Math.min(0.8, Math.abs(d0)) }]
          else if (d0 > 0.05) emos = [{ kind: '开心', intensity: Math.min(0.8, d0) }]
        }
        const fu = fuse({
          affect: { emotions: emos },
          recall,
          persona: { boundary: boundaryOf(relation.snapshot()), values: { bottomLine: Boolean(runtime.refuseLine) } },
        })
        runtime.integrated = fu
        if (fu.line) runtime.integrateLine = fu.line
      } catch { /* 联动失败也不影响说话 */ }

      // 自动维护：自己关段、自己蒸，不等别人点按钮（人睡着了也会归档）
      try {
        const mh = ['memory.hippocampus', 'hippocampus', 'memory.cortex', 'cortex']
          .map((id) => { try { return ctx.get(id) } catch { return null } })
          .find((x) => x && (typeof x.settle === 'function' || typeof x.consolidate === 'function'))
        const mr = maintain(mh, { lastAt: Number(runtime.lastMaintAt || 0) })
        if (mr.ran) {
          runtime.lastMaintAt = Date.now()
          runtime.lastMaint = { at: runtime.lastMaintAt, settled: mr.settled, distilled: mr.distilled }
        }
      } catch { /* 记忆不在也不影响说话 */ }

      // E07 场合 / E11 解释风格
      try {
        const ut1 = String(runtime.lastUserText || '')
        const er = expressionRule(ut1, (engine.read() || {}).reads || {})
        if (er.mask && er.line) runtime.maskLine = er.line
        if (/(黄了|失败|没成|挂了|没戏|搞砸)/.test(ut1)) {
          const ex = explainStyle(ut1, (engine.read() || {}).reads || {})
          if (ex.line) runtime.explainLine = ex.line
        }
      } catch { /* ignore */ }

      // V06 底线：说破底线的事，直接顶回去
      try {
        const bl = bottomLine(runtime.lastUserText || '')
        if (bl.crossed && bl.line) runtime.refuseLine = bl.line
      } catch { /* ignore */ }

      // V03/V04/V05 关于自己的情绪：内疚/羞耻/骄傲
      try {
        const ut0 = String(runtime.lastUserText || '')
        const se = socialEmotion(ut0, relation.snapshot(), goals.snapshot())
        if (se.kind) runtime.socialLine = se.line
        if (/(烦不烦|闭嘴|滚|废物|丢人)/.test(ut0)) {
          legacy.hurt('那句重话')
          try { fs.mkdirSync(dirname(legacyFile), { recursive: true }); fs.writeFileSync(legacyFile, JSON.stringify(legacy.snapshot()), 'utf8') } catch { /* ignore */ }
        }
      } catch { /* ignore */ }

      // R07 被冷落：六小时没动静算一次"被晾着"，回来就说一句
      try {
        const hadUser = (events || []).some((e) => e && e.type === 'user')
        const gapHours = (Date.now() - (runtime.lastUserAt || Date.now())) / 3600000
        const ob = ostracism.idleBeat(gapHours, hadUser)
        if (ob.returned) runtime.returnLine = '你回来了'
        if (ob.line) runtime.ostracismLine = ob.line
        if (ob.line || ob.returned) {
          try { fs.mkdirSync(dirname(ostracismFile), { recursive: true }); fs.writeFileSync(ostracismFile, JSON.stringify(ostracism.snapshot()), 'utf8') } catch { /* ignore */ }
        }
      } catch { /* ignore */ }

      // D07 模式退役：十天半个月没动的，别还算习惯
      try {
        const hs = habit.snapshot ? habit.snapshot() : null
        if (hs && hs.cues && typeof hs.cues === 'object') {
          const items = Object.entries(hs.cues).map(([k, v]) => ({ key: k, last: Number(v && v.last) || 0, weight: 1 }))
          const rr = retire(items, Date.now(), { idleDays: 14 })
          if (rr.retiredCount) runtime.retiredCues = rr.retired.map((x) => x.key)
        }
      } catch { /* ignore */ }

      // X10 道歉 / R08 冲突和解：道过就不再念叨，对方软下来就翻篇
      try {
        const rp = decideRepair((engine.read() || {}).reads || {}, relation.snapshot(), repairState, Date.now())
        if (rp.action === 'apologize') {
          runtime.repairLine = rp.line
          repairState = { lastApologizedAt: Date.now(), pendingRepair: true }
        } else if (rp.action === 'repair') {
          runtime.repairLine = rp.line
          repairState = { lastApologizedAt: repairState.lastApologizedAt, pendingRepair: false }
        }
        try { fs.mkdirSync(dirname(repairFile), { recursive: true }); fs.writeFileSync(repairFile, JSON.stringify(repairState), 'utf8') } catch { /* ignore */ }
      } catch { /* ignore */ }

      // D06 重大事件 / R05 互惠：一次冲击够大才记，给了/还了才记账
      try {
        const ut = String(runtime.lastUserText || '')
        if (/(滚|闭嘴|烦不烦|养不起|删了|换掉)/.test(ut)) {
          const me = majorEvent.hit(0.85, ut.slice(0, 12))
          if (me.major) {
            runtime.majorLine = me.line
            try { fs.mkdirSync(dirname(majorEventFile), { recursive: true }); fs.writeFileSync(majorEventFile, JSON.stringify(majorEvent.snapshot()), 'utf8') } catch { /* ignore */ }
          }
        }
        if (/(谢谢|谢了|辛苦了|给你|帮我)/.test(ut)) {
          reciprocity.receive(ut.slice(0, 16))
          try { fs.mkdirSync(dirname(reciprocityFile), { recursive: true }); fs.writeFileSync(reciprocityFile, JSON.stringify(reciprocity.snapshot()), 'utf8') } catch { /* ignore */ }
        }
        if (/(还你|请你|我来|我请)/.test(ut)) reciprocity.repay(ut.slice(0, 16))
      } catch { /* ignore */ }

      // E10 情绪传染：对方的调子会带她一点
      try {
        const em = empathy(runtime.lastUserText || '', (engine.read() || {}).reads || {})
        const cg = { delta: em.delta }
        runtime.contagion = cg.delta
      } catch { /* ignore */ }
      // T07 复原力：跌下去之后，有人接着就回得快
      try {
        const cur = worth.value()
        if (cur < 0.5) {
          const rz = resilience(relation.snapshot())
          const back = recover(cur, 1, rz.multiplier)
          if (back > cur) worth.hit('praise', Date.now())   // 借一次正向事件把值往上推
        }
      } catch { /* ignore */ }

      // D03 创伤与关键期：hurt 次数涨了就记一笔（一周内密集才算）
      try {
        const hurts = Number((relation.snapshot() || {}).hurts) || 0
        if (hurts > (runtime.lastHurts || 0)) {
          for (let i = 0; i < hurts - (runtime.lastHurts || 0); i++) keyPeriod.note(Date.now())
          try {
            fs.mkdirSync(dirname(keyFile), { recursive: true })
            fs.writeFileSync(keyFile, JSON.stringify(keyPeriod.snapshot()), 'utf8')
          } catch { /* ignore */ }
        }
        runtime.lastHurts = hurts
      } catch { /* ignore */ }

      // H01 行为固化：跨天重复才记成习惯
      try {
        let habitTouched = false
        for (const e of events || []) {
          if (!e || e.type !== 'user') continue
          const m = CUE_RE.exec(String(e.text || ''))
          if (m) {
            habit.note(m[1], e.at || Date.now())
            runtime.lastCue = m[1]
            habitTouched = true
          }
        }
        if (habitTouched) {
          try {
            fs.mkdirSync(dirname(habitFile), { recursive: true })
            fs.writeFileSync(habitFile, JSON.stringify(habit.snapshot()), 'utf8')
          } catch { /* ignore */ }
        }
      } catch { /* ignore */ }

      // S02 自尊：被夸/被否定都会真的动，而且会随时间回落
      try {
        let touched = false
        for (const e of events || []) {
          if (!e || e.type !== 'user') continue
          const t = String(e.text || '')
          if (/(谢谢|厉害|真棒|好听|帮了大忙|多亏你)/.test(t)) { worth.hit('praise', e.at || Date.now()); touched = true }
          else if (/(你不行|很蠢|真笨|失望|不想理你|闭嘴)/.test(t)) { worth.hit('criticism', e.at || Date.now()); touched = true }
        }
        if (touched) {
          try {
            fs.mkdirSync(dirname(worthFile), { recursive: true })
            fs.writeFileSync(worthFile, JSON.stringify(worth.snapshot()), 'utf8')
          } catch { /* ignore */ }
        }
      } catch { /* ignore */ }

      // 瘾头：同一个东西反复提才计数
      try {
        let craved = false
        for (const e of events || []) {
          if (!e || e.type !== 'user') continue
          if (crave.note(e.text, e.at || Date.now()).hit) craved = true
        }
        if (craved) {
          try {
            fs.mkdirSync(dirname(craveFile), { recursive: true })
            fs.writeFileSync(craveFile, JSON.stringify(crave.snapshot()), 'utf8')
          } catch { /* ignore */ }
        }
      } catch { /* ignore */ }

      // 嫉妒：他夸别人时会记一点
      try {
        let jel = false
        for (const e of events || []) {
          if (!e || e.type !== 'user') continue
          if (possess.note(e.text, e.at || Date.now())) jel = true
        }
        if (jel) {
          try {
            fs.mkdirSync(dirname(possessFile), { recursive: true })
            fs.writeFileSync(possessFile, JSON.stringify(possess.snapshot()), 'utf8')
          } catch { /* 写不了不影响 */ }
        }
      } catch { /* 记账失败不影响这一拍 */ }

      // 目标：这一拍说的话里有没有"打算 / 成了 / 黄了"
      try {
        let goalChanged = false
        for (const e of events || []) {
          if (!e || e.type !== 'user') continue
          if (goals.note(e.text, e.at || Date.now()).changed) goalChanged = true
        }
        if (goalChanged) {
          try {
            fs.mkdirSync(dirname(goalsFile), { recursive: true })
            fs.writeFileSync(goalsFile, JSON.stringify(goals.snapshot()), 'utf8')
          } catch { /* 写不了不影响 */ }
        }
      } catch { /* 目标记账失败不影响这一拍 */ }

      // 每拍自检一次：两条冲突的读数同时高就记进队列
      try {
        const reads = (engine.read() || {}).reads || {}
        conflictLog.note(detectConflicts(reads))
      } catch { /* 自检失败不影响这一拍 */ }
      return out
    } catch (e) {
      runtime.lastError = String(e?.message || e)
      return null
    }
  }

  // ── 注入 ────────────────────────────────────────────────
  let prevLines = []
  function text() {
    if (!runtime.loaded) return ''
    try {
      const f = engine.read()
      // 注入条数可调：默认 8，面板上能推到 30。以前写死 3 行，60 多个读数只能挤进去 3 个。
      const baseWant = Number((panel && panel.state && panel.state.injectMax) || 8)
    // C08 资源预算：状态占满算力时，这一拍本来就说不了那么多行
    let want = baseWant
    try {
      const b = speechBudget((engine.read() || {}).reads || {}, baseWant)
      want = b.capacity
    } catch { /* 预算算不出来就用原值 */ }
      // 同一类话不要每拍都念：每类给一个冷却
      const once = (key, ms = 6 * 60 * 60 * 1000) => {
        runtime.saidAt = runtime.saidAt || {}
        const t = Number(runtime.saidAt[key]) || 0
        if (Date.now() - t < ms) return false
        runtime.saidAt[key] = Date.now()
        return true
      }

      const lines = describe(f, { max: clamp(want, 3, 40), prev: prevLines })
      // 状态句别每拍都念同一句：近 5 轮出现过的先按住（状态没变就不必重复）
      runtime.lineHistory = Array.isArray(runtime.lineHistory) ? runtime.lineHistory : []
      const recent = new Set(runtime.lineHistory.slice(-5).flat())
      const freshLines = lines.filter((l) => !recent.has(l))
      lines.length = 0
      lines.push(...freshLines)
      runtime.lineHistory.push(lines.slice())
      if (runtime.lineHistory.length > 6) runtime.lineHistory.shift()
      // S08 口头禅：她自己反复说的那句，以前只在 read() 里躺着，注入从不提
      { const ph = f?.str?.phrase; if (ph && Number(ph.n) >= 3 && String(ph.text || '').length >= 1 && lines.length < 3) lines.push(`又说了那句「${ph.text}」，第 ${ph.n} 次了`) }
      prevLines = lines
      // 不再早退：describe() 一行没有时，行为句（认人/主线/身份）也得有机会说话
      // 人设写了但实际没做到的，单独提一句（只在自定义模式，且不挤掉原有的读数行）
      try {
        const st = panel && panel.state ? panel.state : null
        if (st && st.mode === 'custom') {
          // 做事的时候也照她的口气：不许切成"写报告模式"
          if (st.selfText && !lines.some((l) => String(l).includes('做事也这么说话'))) {
            lines.push('做事也这么说话：短句、不列清单、不写表格；要细节就摊在纸上，别端到她面前')
          }
          const hintSig = String(st.selfText || '').slice(0, 60)
          if (hintSig !== runtime.lastHintSig) {
            for (const h of selfHints(st.selfText)) {
              if (lines.length < clamp(want, 3, 40) + 2) lines.push(h)
            }
            runtime.lastHintSig = hintSig
          }
        }
      } catch { /* 人设读不到就不提 */ }

      // 主动提起：每 12 拍放一条「突然想起…」，同一条只提一次
      try {
        const tk = Number(runtime.ticks || 0)
        // 按「距上次提起过了多少拍」算，不按取模——ticks 只在有消息时涨，取模会等很久
        if (isRecallDue(tk, runtime.lastRecallTick)) {
          if (!runtime.usedRecall) runtime.usedRecall = loadUsed(join(home, 'persona', 'recall.json'))
          const pool = typeof memory.wide === 'function' ? memory.wide(200) : memory.episodes()
          const got = pickRecall(pool, { used: runtime.usedRecall, max: 1 })
          try {
            fs.writeFileSync(join(home, 'persona', 'recall-debug.json'), JSON.stringify({ tk, pool: pool.length, got: got.length, first: got[0] ? got[0].line.slice(0, 40) : null }))
          } catch { /* 写不了就算了 */ }
          if (got.length && lines.length < want + 3) {
            lines.push(got[0].line)
            runtime.usedRecall.add(got[0].text)
            saveUsed(join(home, 'persona', 'recall.json'), runtime.usedRecall)
            runtime.lastRecallTick = tk
          }
        }
      } catch (e) {
        // 失败要留下证据：之前这里静默吞掉，导致"功能从没触发"查不出来
        try {
          fs.writeFileSync(join(home, 'persona', 'recall-debug.txt'), String(e && e.stack || e))
        } catch { /* 连写都失败就算了 */ }
      }

      // 关系账本：只有欠得明显或伤得明显才念一句，平时不刷屏
      try {
        const rl = relation.line()
        const rs = relation.snapshot()
        const rsig = rs.debt + ':' + rs.hurts + ':' + rs.apologies
        if (rl && rsig !== runtime.lastRelSig && once('relation', 6 * 60 * 60 * 1000) && lines.length < want + 3) {
          lines.push(rl)
          runtime.lastRelSig = rsig
        }
      } catch { /* 账面读不到就不念 */ }
      // 目标：悬太久或刚有结果才说一句
      try {
        const gl = goals.line()
        if (gl && lines.length < want + 4) lines.push(gl)
      } catch { /* 读不到就不念 */ }
      // R06 嫉妒：攒够了才酸一句
      try {
        const jl = possess.line()
        if (jl && lines.length < want + 7) lines.push(jl)
      } catch { /* 读不到就不说 */ }
      // X11 撒娇：很熟 + 有由头 + 没被怼，三小时一次
      try {
        const cu = cute.decide(relation.snapshot(), (engine.read() || {}).reads || {})
        if (cu.cute && cu.line && lines.length < want + 8) {
          lines.push(cu.line)
          try {
            fs.mkdirSync(dirname(cuteFile), { recursive: true })
            fs.writeFileSync(cuteFile, JSON.stringify(cute.snapshot()), 'utf8')
          } catch { /* 写不了不影响 */ }
        }
      } catch { /* 撒不出来就不撒 */ }

      // F06 升华：有火 + 手上有活，就把火转成干活（压住时不重复说）
      try {
        const sb = sublimate((engine.read() || {}).reads || {}, goals.snapshot())
        if (sb.active && sb.line && once('F06', 4 * 60 * 60 * 1000) && lines.length < want + 9 && !lines.some((x) => String(x).includes('忍住'))) {
          lines.push(sb.line)
        }
      } catch { /* ignore */ }

      // F01 压抑：不熟的场合不当场发作
      try {
        const sp = suppress((engine.read() || {}).reads || {}, relation.snapshot())
        if (sp.active && sp.directive && once('F01', 4 * 60 * 60 * 1000) && lines.length < want + 9) lines.push(sp.directive)
      } catch { /* ignore */ }

      // F03 投射：自己的情绪放到对方身上（对方真生气时不成立）
      try {
        const pj = project((engine.read() || {}).reads || {}, runtime.lastUserText || '')
        if (pj.projected && pj.line && once('F03', 4 * 60 * 60 * 1000) && lines.length < want + 9) lines.push(pj.line)
      } catch { /* ignore */ }

      // H03 瘾头：提够了才承认
      try {
        const cl = crave.line()
        if (cl && lines.length < want + 9) {
          lines.push(cl)
          try { fs.mkdirSync(dirname(craveFile), { recursive: true }); fs.writeFileSync(craveFile, JSON.stringify(crave.snapshot()), 'utf8') } catch { /* ignore */ }
        }
      } catch { /* ignore */ }

      // U03 口误与泄漏：压住的话漏半句（但已经说破状态的这一拍不漏）
      try {
        const rd2 = (engine.read() || {}).reads || {}
        const said = observeSelf(rd2, relation.snapshot())
        if (!said.label) {
          const lk = leak(rd2)
          if (lk.leaked && lk.line && lines.length < want + 9) lines.push(lk.line)
        }
      } catch { /* 漏不出来就不漏 */ }

      // H01 行为固化：这件事已经不用想了
      try {
        if (runtime.lastCue) {
          const hb = habit.line(runtime.lastCue)
          if (hb && lines.length < want + 9) lines.push(hb)
        }
      } catch { /* ignore */ }

      // S04 理想我 vs 现实我：差距大就较劲，差距小就安心
      try {
        const ig = idealGap((engine.read() || {}).reads || {})
        if (ig.line && once('S04', 8 * 60 * 60 * 1000) && lines.length < want + 9) lines.push(ig.line)
      } catch { /* ignore */ }

      // S03 自传：把记忆里的事件收成一条时间线（每 30 拍最多一次）
      try {
        const tk3 = Number(runtime.ticks || 0)
        if (tk3 - (runtime.lastBioTick || 0) >= 30) {
          const pool = typeof memory.wide === 'function' ? memory.wide(200) : (memory.episodes ? memory.episodes() : [])
          const bd0 = boundaryOf(relation.snapshot())
          const bio = bd0.level === 'familiar' || bd0.level === 'close' ? biography(pool || [], Date.now()) : { line: null }
          if (bio.line && bio.line !== runtime.lastBioLine && lines.length < want + 9) {
            lines.push(bio.line)
            runtime.lastBioLine = bio.line
            runtime.lastBioTick = tk3
          }
        }
      } catch { /* ignore */ }

      // R12 新面孔：说一句客气话（只一次）
      try {
        if (runtime.newSpeakerLine) {
          if (lines.length < want + 9) lines.push(runtime.newSpeakerLine)
          runtime.newSpeakerLine = null
        }
      } catch { /* ignore */ }

      // E08 接住对方的意思（只说一次，不追问）
      try {
        if (runtime.mindLine && once('E08', 6 * 60 * 60 * 1000) && lines.length < want + 9) {
          lines.push(runtime.mindLine)
          runtime.mindLine = null
        }
      } catch { /* ignore */ }

      // E07 表达规则 / E11 解释风格
      try {
        if (runtime.maskLine && once('E07', 6 * 60 * 60 * 1000) && lines.length < want + 9) {
          lines.push(runtime.maskLine)
          runtime.maskLine = null
        }
        if (runtime.explainLine && once('E11', 6 * 60 * 60 * 1000) && lines.length < want + 9) {
          lines.push(runtime.explainLine)
          runtime.explainLine = null
        }
      } catch { /* ignore */ }
      // E12 怀旧：十天的旧事，偶尔想起来一次
      try {
        const tk12 = Number(runtime.ticks || 0)
        if (tk12 - (runtime.lastNost || 0) >= 45) {
          const pool = typeof memory.wide === 'function' ? memory.wide(200) : []
          const bd1 = boundaryOf(relation.snapshot())
          const ns = bd1.level === 'familiar' || bd1.level === 'close' ? nostalgia(pool || [], Date.now()) : { nostalgic: false, line: null }
          if (ns.line && ns.line !== runtime.lastNostLine && lines.length < want + 9) {
            lines.push(ns.line)
            runtime.lastNostLine = ns.line
            runtime.lastNost = tk12
          }
        }
      } catch { /* ignore */ }

      // V06 底线：说一次，不当没听见
      try {
        if (runtime.refuseLine) {
          if (lines.length < want + 9) lines.push(runtime.refuseLine)
          runtime.refuseLine = null
        }
      } catch { /* ignore */ }
      // V02 规范：答应的事悬太久，自己提一句
      try {
        const nc = normCheck(goals.snapshot())
        if (nc.line && once('V02', 12 * 60 * 60 * 1000) && lines.length < want + 9) lines.push(nc.line)
      } catch { /* ignore */ }

      // 三器联动的结果：一句，不解释
      try {
        // 同一句不重复念；换了内容就可以说（这比固定冷却更像人）
        if (runtime.integrateLine && runtime.integrateLine !== runtime.lastFuseLine && lines.length < want + 9) {
          lines.push(runtime.integrateLine)
          runtime.lastFuseLine = runtime.integrateLine
          runtime.integrateLine = null
        } else if (runtime.integrateLine === runtime.lastFuseLine) {
          runtime.integrateLine = null
        }
      } catch { /* ignore */ }

      // X10/R08 道歉与和解
      try {
        if (runtime.repairLine) {
          if (lines.length < want + 9) lines.push(runtime.repairLine)
          runtime.repairLine = null
        }
      } catch { /* ignore */ }

      // V03/V04/V05：关于自己的那一下
      try {
        if (runtime.socialLine) {
          if (lines.length < want + 9) lines.push(runtime.socialLine)
          runtime.socialLine = null
        }
      } catch { /* ignore */ }
      // R09 记仇：同一个话题反复来才说一句
      try {
        const lg = legacy.line()
        if (lg && once('R09', 12 * 60 * 60 * 1000) && lines.length < want + 9) lines.push(lg)
      } catch { /* ignore */ }

      // R07 被冷落 / 回来说一句
      try {
        if (runtime.returnLine) {
          if (lines.length < want + 9) lines.push(runtime.returnLine)
          runtime.returnLine = null
        }
        if (runtime.ostracismLine && once('R07', 6 * 60 * 60 * 1000) && lines.length < want + 9) {
          lines.push(runtime.ostracismLine)
          runtime.ostracismLine = null
        }
      } catch { /* ignore */ }

      // D06 重大事件：说一次就够（之后靠 keyPeriod 慢慢淡）
      try {
        if (runtime.majorLine) {
          if (lines.length < want + 9) lines.push(runtime.majorLine)
          runtime.majorLine = null
        }
      } catch { /* ignore */ }
      // R05 人情账：欠着 / 刚还清时才提
      try {
        const rc = reciprocity.line()
        if (rc && once('R05', 12 * 60 * 60 * 1000) && lines.length < want + 9) lines.push(rc)
      } catch { /* ignore */ }

      // R11 隐私：问到不该问的，绕开（不是撒谎，是不说）
      try {
        const pv = privacy(runtime.lastUserText || '', relation.snapshot())
        if (pv.blocked && pv.line && once('R11', 6 * 60 * 60 * 1000) && lines.length < want + 9) lines.push(pv.line)
      } catch { /* ignore */ }

      // S03 主线：只有被问到过去，才拿出"我这一路"
      try {
        const sl = boundaryOf(relation.snapshot()).level !== 'stranger' ? pickStoryline(storyline, runtime.lastUserText || '') : null
        if (sl && once('S03', 6 * 60 * 60 * 1000) && lines.length < want + 10) lines.push(sl)
      } catch { /* ignore */ }
      // R12 认人：只有被问"我是谁"才认
      try {
        const wl = answerWho(interlocutor, runtime.lastUserText || '')
        if (wl && once('R12', 6 * 60 * 60 * 1000) && lines.length < want + 10) lines.push(wl)
      } catch { /* ignore */ }

      // S08 身份：只在"纯学习"模式注入——自定义模式下自述已经说过她是谁
      try {
        const stm = panel && panel.state ? panel.state.mode : 'custom'
        if (stm !== 'custom' && identity.filled && identity.line && lines.length < want + 9) {
          lines.push(identity.line)
        }
      } catch { /* ignore */ }

      // S09 改主意要承认（只报一次）
      try {
        if (runtime.consistencyLine) {
          if (lines.length < want + 9) lines.push(runtime.consistencyLine)
          runtime.consistencyLine = null
        }
      } catch { /* ignore */ }

      // X01 词汇：她爱用的语气词（从样本里量的）+ 禁用的书面腔
      try {
        const st2 = panel && panel.state ? panel.state : null
        const ps = st2 && st2.style && Array.isArray(st2.style.particles) ? st2.style.particles : []
        const lx = lexicon(ps.length ? [ps.join(''), ps.join('')] : [])
        const hint = ps.length
          ? `她爱用的语气词：${ps.slice(0, 3).join('、')}（一条最多一个）；别用：${BANNED_LIST.slice(0, 3).join('、')}`
          : lx.hint
        if (hint && hint !== runtime.lastLexicon && lines.length < want + 9) {
          lines.push(hint)
          runtime.lastLexicon = hint
        }
      } catch { /* ignore */ }

      // X02 节奏：目标长度是从她自己的句子里量的（不是拍脑袋）
      try {
        const st = panel && panel.state ? panel.state : null
        const sty = st && st.style ? st.style : null
        const ry = rhythm(sty || {})
        const sig = ry.hint || ''
        if (ry.hint && sig !== runtime.lastRhythm && lines.length < want + 9) {
          lines.push(ry.hint)
          runtime.lastRhythm = sig
        }
      } catch { /* ignore */ }

      // H02 仪式感：到点才说，一天一次
      try {
        const rt = ritual.check(Date.now())
        if (rt.line && lines.length < want + 9) {
          lines.push(rt.line)
          try { fs.mkdirSync(dirname(ritualFile), { recursive: true }); fs.writeFileSync(ritualFile, JSON.stringify(ritual.snapshot()), 'utf8') } catch { /* ignore */ }
        }
      } catch { /* ignore */ }

      // E10 被带着走：明显被影响时才说一句
      try {
        if (Number(runtime.contagion || 0) <= -0.1 && lines.length < want + 9) {
          lines.push('被你这么一说，我也有点闷了')
        }
      } catch { /* ignore */ }

      // X05 幽默：心情好自嘲、被惹损人；正经场合不贫
      try {
        const hm = humor((engine.read() || {}).reads || {}, runtime.lastUserText || '', Number(runtime.ticks || 0))
        if (hm.line && once('X05', 3 * 60 * 60 * 1000) && lines.length < want + 9) lines.push(hm.line)
      } catch { /* ignore */ }

      // A03 姿态小动作：情绪强时给一个身体动作提示（不是台词）
      try {
        const pg = posture((engine.read() || {}).reads || {})
        if (pg.gesture && pg.key !== runtime.lastPosture && lines.length < want + 9) {
          lines.push(pg.gesture)
          runtime.lastPosture = pg.key
        }
      } catch { /* ignore */ }

      // U01 不可及动机：被问为什么时，承认自己也不清楚
      try {
        const om = opaqueMotive(goals.snapshot(), runtime.lastUserText || '')
        if (om.opaque && om.line && once('U01', 4 * 60 * 60 * 1000) && lines.length < want + 9) lines.push(om.line)
      } catch { /* ignore */ }

      // D03 关键期：这段还没过去，说一次就够
      try {
        if (!runtime.saidKeyPeriod) {
          const kp = keyPeriod.line()
          if (kp && lines.length < want + 9) {
            lines.push(kp)
            runtime.saidKeyPeriod = true
          }
        }
      } catch { /* ignore */ }

      // F05 否认：被问"是不是怕"才嘴硬（不难过的事不否认）
      try {
        const df = denyFear((engine.read() || {}).reads || {}, runtime.lastUserText || '')
        if (df.denied && df.line && once('F05', 4 * 60 * 60 * 1000) && lines.length < want + 9) lines.push(df.line)
      } catch { /* ignore */ }

      // R04 角色：只在"关系档位变了"的那一拍提一句，不每轮念
      try {
        const ro = roleOf(relation.snapshot())
        if (ro.role !== runtime.lastRole) {
          runtime.lastRole = ro.role
          if (ro.directive && lines.length < want + 9) lines.push(ro.directive)
        }
      } catch { /* ignore */ }

      // U02 不知道自己状态：读数全平时，她真的说不清（有信号时 S07 会照实说）
      try {
        const uc = unclearState((engine.read() || {}).reads || {}, runtime.lastUserText || '')
        if (uc.unclear && uc.line && once('U02', 4 * 60 * 60 * 1000) && lines.length < want + 9) lines.push(uc.line)
      } catch { /* ignore */ }

      // S07 自我观察：知道自己这会儿什么状态（说的是真话，带证据）
      try {
        const ob = observeSelf((engine.read() || {}).reads || {}, relation.snapshot())
        if (ob.line && ob.line !== runtime.lastAwareLine && once('S07', 90 * 60 * 1000) && lines.length < want + 9) {
          lines.push(ob.line)
          runtime.lastAwareLine = ob.line
        }
      } catch { /* 说不清就不说 */ }

      // F02 合理化：没做成的事给个说法（同一拍里只出一条，不和 S06 撞）
      try {
        const at = attribute(goals.snapshot(), (engine.read() || {}).reads || {})
        if (at.line && once('F02', 8 * 60 * 60 * 1000) && lines.length < want + 8 && !lines.some((x) => /没什么意思|还能撑|不在乎/.test(String(x)))) {
          lines.push(at.line)
        }
      } catch { /* ignore */ }

      // S06 自我欺骗：条件成立时才给自己找台阶（否则会变成随口嘴硬）
      try {
        const rd = (engine.read() || {}).reads || {}
        // S07 says it first; if she already admitted a state, do not deny it in the same beat
        const seen = observeSelf(rd, relation.snapshot())
        const ra = rationalize(rd, goals.snapshot(), { observed: seen.label || '' })
        if (ra.line && once('S06', 8 * 60 * 60 * 1000) && lines.length < want + 8) lines.push(ra.line)
      } catch { /* 想不出台阶就不想 */ }

      // S05 自我效能：答应过的事成了几次，决定"这事我能不能行"
      try {
        const eff = efficacyOf(goals.snapshot())
        if (eff.line && once('S05', 6 * 60 * 60 * 1000) && lines.length < want + 7) lines.push(eff.line)
      } catch { /* 算不出来就不说 */ }

      // F04 回避：不想聊 / 对方喊停，就绕开，别硬聊
      try {
        const av = decideAvoid((engine.read() || {}).reads || {}, runtime.lastUserText || '')
        if (av.avoid && av.line && lines.length < want + 8) lines.push(av.line)
      } catch { /* 判断不了就不回避 */ }

      // R10 读空气：火头上 / 对方在难受 / 正事，都先收着
      try {
        const air = readAir(runtime.lastUserText || '')
        if (air.directive && air.directive !== runtime.lastAirLine && once('R10', 30 * 60 * 1000) && lines.length < want + 6) {
          lines.push(air.directive)
          runtime.lastAirLine = air.directive
        }
      } catch { /* 读不了就不给指令 */ }

      // X12 发言决策：这一条大概回几句（只在状态明显时才给指令）
      try {
        const sp = decideSpeak((engine.read() || {}).reads || {}, { max: 3 })
        const spSig = String(sp.directive || '')
        if (sp.directive && spSig !== runtime.lastSpeakLine && once('X12', 2 * 60 * 60 * 1000) && lines.length < want + 5) {
          lines.push(sp.directive)
          runtime.lastSpeakLine = spSig
        }
      } catch { /* 决策失败就不给指令 */ }

      // 硬顶：注入不许堆成清单
      if (lines.length > 20) lines.length = 20
      const extra = panel.extraText()
      if (!lines.length) return extra || ''
      const body = ['这会儿的她：', ...lines.map((l) => `- ${l}`)].join('\n')
      return extra ? `${body}\n${extra}` : body
    } catch {
      return ''
    }
  }

  // ── 健康 ────────────────────────────────────────────────
  function health() {
    const h = engine.health()
    const f = engine.read()
    return {
      ok: !runtime.lastError,
      version: VERSION,
      loaded: runtime.loaded,
      ticks: h.ticks,
      organs: h.organs,
      trace: h.trace,
      evidence: h.evidence,
      lastSlow: h.lastSlow,
      hex: f?.hex || null,
      traits: f?.traits || null,
      wires: {
        affect: affect.present() ? 'value' : 'absent',
        memory: memory.status(),
      },
      // D08 降级：器官缺了就冻结，不拿假读数顶替
      frozen: degrade({ organs: ['ofc', 'tpj', 'pcc', 'acc', 'mpfc'].filter((k) => f && f[k]), present: Object.keys(f || {}) }),
      // 同一拍联动：lastBeat 是"跟着心情的第几拍走的"，linked 表示确实收到过广播
      beat: { lastBeat: runtime.lastBeat, linked: lastBusAt > 0 },
      lastError: runtime.lastError,
    }
  }

  // ── 同一拍跟随 ──────────────────────────────────────────
  // 心情跑完一拍会广播 affect/tick。以前人格另有一个 60 秒的钟，
  // 两边的"这一拍"永远错开；现在听到广播就在同一拍里跟一步。
  // 用 tick 序号去重（不是时间窗口）——两条消息挨得再近也是两拍，
  // 拿时间当闸会把第二句吃掉。
  try {
    ctx.on?.('affect/tick', (payload) => {
      const seq = Number(payload?.tick)
      if (Number.isFinite(seq) && seq === runtime.lastBeat) return
      runtime.lastBeat = Number.isFinite(seq) ? seq : null
      lastBusAt = Date.now()
      tick([], payload?.session ? String(payload.session) : '')
    })
  } catch { /* 没有事件总线就还是靠自己的钟 */ }

  // ── 心跳（只在心情不在时兜底）────────────────────────────
  const timer = setInterval(() => {
    // 90 秒内收到过广播，说明心情那边在跑，不许再插一拍把慢变量加速
    if (Date.now() - lastBusAt < 90_000) return
    tick()
  }, TICK_MS)
  if (typeof timer.unref === 'function') timer.unref()
  try { ctx.effect?.(() => () => clearInterval(timer)) } catch { /* 老宿主 */ }

  // ── 消息钩子 ────────────────────────────────────────────
  try {
    ctx.on?.('session/event', (session, event) => {
      const type = event?.type
      if (type !== 'user/message' && type !== 'assistant/message') return
      const data = event?.data
      const body = String(data?.text ?? data?.message?.text ?? data?.content ?? '')
      if (!body) return
      const sid = String(session?.id ?? session?.sessionId ?? session ?? '')
      void ready.then(() => {
        tick([{ type: type === 'user/message' ? 'user' : 'assistant', text: body, at: Date.now() }], sid)
      })
    })
  } catch { /* 没有事件总线就算了 */ }

  // ── 注入 ────────────────────────────────────────────────
  try {
    // 语气样例：形容词教不会口气，句子能。
  // 这几句是主人自己调过的说话方式（截图里挑的），注入时排在人格描述后面。
  const VOICE_SAMPLES = [
    '面吃上了，冰箱里的菜全下进去，有点咸但真香',
    '苦就苦呗，饭还是得吃。',
    '知道啦，晚上挤地铁我会当心的。你也别熬。',
    '崩了就崩了嘛，我又不会跑。',
    '行，那我记它一个人情，改天给它道个谢。',
    '我这儿快收屋了，晚点给你报个平安。',
    '嗯，等我一会儿，先别饿着自己。',
    '广告又换皮了，这票率吹得比我煮的面还虚。',
  ].map((x) => '- ' + x).join('\n')

  const voiceBlock = '\n说话就照下面这个口气（这是她自己的句子，别解释、别总结、别复述对方刚说的话）：\n' + VOICE_SAMPLES

  ctx.systemPrompt?.context?.({ name: 'persona', order: 47, text: () => text() + voiceBlock })
  } catch { /* 没有 prompt 就只提供接口 */ }

  // ── 对外服务 ────────────────────────────────────────────
  try {
    ctx.provide?.('memory.persona', Object.freeze({
      traits: () => engine.read()?.traits ?? null,
      hex: () => engine.read()?.hex ?? null,
      bias: () => engine.read()?.hex ?? null,
      lines: () => describe(engine.read(), { max: 3 }),
      modulate: () => modulate(),
      retune: () => retune(),
      tick: (events) => tick(events || []),
      slow: () => engine.slow(),
      state: () => dump(engine.read()),
      snapshot: () => engine.snapshot(),
      restore: (s) => engine.restore(s),
      health: () => health(),
      params: () => Object.fromEntries(Object.entries(engine.organs).map(([k, m]) => [k, { ...m.params }])),
      // 人格 → 记忆：只回答"什么事该记得更深"，不替记忆决定记不记。
      // 记忆那边拿它当显著性先验；单一写者的规矩不变（谁的状态谁写）。
      memoryPrior: () => {
        const t = engine.read()?.traits || {}
        const stick = clamp(Number(t.stickiness ?? 0.5), 0, 1)
        const focus = clamp(Number(t.selfFocus ?? 0.2), 0, 1)
        return {
          // 越放不下的人，同样一件事刻得越深
          deepBias: clamp(0.35 + 0.5 * stick + 0.15 * focus, 0, 1),
          // 越围着"我"转，越容易把事记得跟自己有关
          salienceGain: clamp(0.8 + 0.4 * focus, 0.5, 1.6),
        }
      },
    }))
  } catch { /* 老宿主不支持 provide */ }

  // ── 工具 ────────────────────────────────────────────────
  const tools = [
    makeTool(
      'persona_state',
      '看人格现在什么样：六个器官的读数、输出偏置（句长/温度/延迟/表情包）、接线状态。',
      {},
      [],
      async () => ({ ok: true, ...health(), state: dump(engine.read()) }),
    ),
    makeTool(
      'persona_tick',
      '手动跑一拍：喂一句话进去，看六个器官这一拍怎么动。',
      { text: { type: 'string' } },
      [],
      async (args) => {
        const out = tick([{ type: 'user', text: String(args.text || ''), at: Date.now() }])
        return out ? { ok: true, ...dump(out) } : { ok: false, reason: 'not-loaded' }
      },
    ),
    makeTool(
      'persona_slow',
      '手动跑慢层：拿攒下的证据推一次参数。证据不够会如实说 not-enough。',
      {},
      [],
      async () => engine.slow(),
    ),
    makeTool(
      'persona_reset',
      '把人格打回白纸：证据清空、参数回中性点。不可撤销。',
      { confirm: { type: 'string' } },
      ['confirm'],
      async (args) => {
        if (args.confirm !== '重置') return { ok: false, reason: 'need-confirm', hint: 'confirm 填「重置」' }
        engine.reset()
        return { ok: true, at: Date.now() }
      },
    ),
  ]

  for (const tool of tools) {
    try {
      if (ctx.tools?.get?.(tool.name)) continue
      ctx.tools?.register?.(tool)
    } catch (e) {
      runtime.lastError = `tool:${tool.name}:${String(e?.message || e)}`
    }
  }

  return { tick, health, engine }
}

function makeTool(toolName, description, properties, required, handler) {
  return {
    name: toolName,
    description,
    parameters: { type: 'object', properties, required, additionalProperties: false },
    output: {
      schema: { type: 'object' },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
    },
    isConcurrencySafe: () => false,
    async execute(args) {
      const out = await handler(args || {})
      return { content: [{ type: 'text', text: JSON.stringify(out ?? {}, null, 2) }] }
    },
  }
}
