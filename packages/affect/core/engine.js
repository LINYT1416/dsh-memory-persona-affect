// 心跳引擎：单一时钟、A/B 两段、同一帧读、补算反转、资源池、回滚。
// 五个器官 + 三层 + 四补充 + 时间 + IO，共 15 个模块。

import { clamp, rng, hash } from './consts.js'
import { fuse, positiveEvent } from './fuse.js'
import { render, COVER as INJECT_COVER } from './inject.js'
import { createResources } from './resource.js'
import { analyzeMessage, buildContext } from './context.js'

import { create as amygdala } from '../organs/amygdala.js'
import { create as hypothalamus } from '../organs/hypothalamus.js'
import { create as insula } from '../organs/insula.js'
import { create as hippocampus } from '../organs/hippocampus.js'
import { create as pfc } from '../organs/pfc.js'
import { create as neuromod } from '../layers/neuromod.js'
import { create as attention } from '../layers/attention.js'
import { create as social } from '../layers/social.js'
import { create as brainstem } from '../supplements/brainstem.js'
import { create as dmn } from '../supplements/dmn.js'
import { create as endocrine } from '../supplements/endocrine.js'
import { create as sickness } from '../supplements/sickness.js'
import { create as curve } from '../time/curve.js'
import { create as rhythm } from '../time/rhythm.js'
import { create as bias } from '../io/bias.js'
import { create as output } from '../io/output.js'

export const PERSONA_DEFAULT = {
  // moodBase：长期底色，必须是正的（0.1）。线上卡在 -0.649 那阵，问题不是"她该低落"，
  //   而是"痛过之后回不来"——底色本身没被写成负数，是威胁/回声一直把她按在下面。
  // tauMoodH：朝底色回落的时间常数，单位小时。0.75h（45 分钟）太短：
  //   被夸两句还没来得及变成"这个下午不错"就被拉回去了，被扎一下也留不住。
  //   1.25h 更接近"一下午"的量级：静默三小时能回到基线附近；秒级的"当场"由 tick 里的冲量负责。
  moodBase: 0.1, tauMoodH: 1.25, moodCap: 0.75,
  // ── 即时威胁 / 缓过来 / 记仇：三把不同的尺子，别混成一个数 ──────────────
  // tauThreatMin：即时威胁那一层的参照时间常数（分钟）。杏仁核自己就是 8 分钟（tauThreat）。
  //   线上实测 threat 钉在 1、每 70 秒只掉 3%，根子不是"衰减太慢"，是它每拍又被重新点着：
  //   ① 记忆回声每一拍都 +0.12×负性（同一件旧事，一分钟扎一次）；
  //   ② 情境恐惧的托底 0.2×情境 用 max 兜住，落不下去；
  //   ③ frustration 被压到 0.998，触发阈值砍半，等于每句话都扎得更重。
  //   所以引擎这一层做的是"别让它被点着"（下面 E4/E5/E6），衰减仍交给器官的 8 分钟；
  //   这个数在这里的作用是给"被怼那股劲"定标：frustration 的 tau = 2.5×tauThreatMin = 20 分钟。
  tauThreatMin: 8,
  // threatSpike：连着被冒犯时，即时威胁朝 1 顶多远（0..1 的比例，不是绝对增量）。
  //   第一次被扎 = 0（器官那一下就是"扎了一下"，回多慢、话多短整条链都是按它标定的）；
  //   第二、第三次才真的火起来（ramp 0 → 0.5 → 1）。
  //   用"朝 1 走多远"而不是"加多少"：已经很高时同一句再顶也不多，和器官里的饱和同路。
  threatSpike: 0.55,
  // tauCalmMin：安静下来、威胁已经低了之后，"低于底色那一段心情"的回升时间常数（分钟）。
  //   只作用于 mood < moodBase 的差额——缓过来快，飘起来照旧慢慢落回。
  //   40 分钟太慢：线上被顶到 −0.65 之后，威胁十分钟就落到 0.2 了，心情却还挂在 −0.5。
  //   13 分钟是"这件事过去了，这一下午还能缓过来"的量级（10 分钟走完约 32% 的差额，
  //   到这个存档能回到 −0.32 上下）；真正的长期底色仍由 tauMoodH(1.25h) 管。
  tauCalmMin: 10,
  // tauQuietMin：「安静下来"消气"」的时间常数（分钟），只作用于高出地板的那一截威胁。
  //   和器官的 tauThreat(8) 分工：那一条是"这一下有多疼"（一次刺激的衰减），
  //   这一条是"没人再提，气多久散"。两条串起来 ≈ 4.8 分钟量级：
  //   被顶到 1 之后，约 8 分钟落到 0.25、约 10 分钟落到 0.2（A06 场景托底）。
  //   quietAfterMin：多久没人说话才算"安静期"——3 分钟以内的停顿还是同一次对话，
  //   不加这一层（否则一句道歉之后 1 分钟，"道歉压了多少"会被安静期的衰减抢走）。
  tauQuietMin: 12,
  quietAfterMin: 3,
  // calmThreatGate：「缓过来」这条慢线允许启动的威胁上限（0..1）。
  //   以前写死 0.35，等于"威胁回到 0.35 以下才准心情回升"；线上威胁从 1 退到 0.35
  //   要七八分钟，那十分钟里心情一点不动——这就是"威胁下来了、心情还贴地板"。
  //   0.5 是"明显在退（掉了一半）就可以开始缓"，还没退到一半时不假装没事。
  calmThreatGate: 0.85,
  // echoFreshMin：记忆回声的"新鲜度"时间常数（分钟）。
  //   回声挂在**那一句话**上，安静之后同一份缓存会一直留在 state 里；
  //   以前它每拍都按全额拽心情（moodTarget 里 0.10×echoPull）、还给器官喂负性，
  //   于是"一分钟前想起的那件旧事"等于整晚都在拽她。15 分钟后只剩 1/e。
  echoFreshMin: 15,
  // grudgePerOffense：一次冒犯记进关系账本多少质量（0..1）；grudgeTauH 小时掉一半。
  //   这就是"记仇"：单次事件不会永久钉死，十次会攒出 0.6 以上，两天掉一半。
  grudgePerOffense: 0.12, grudgeTauH: 48,
  tickMs: 60_000, injectMaxLines: 7,
}

// 正常顺序：身体 → 调质 → 感受 → 记忆 → 偏置 → 社会 → 注意 → 走神 → 调节 → 曲线 → 节律 → 输出
const ORDER_B = [
  'amygdala',
  'hypothalamus', 'brainstem', 'endocrine', 'sickness', 'neuromod',
  'insula', 'hippocampus', 'bias', 'social', 'attention', 'dmn',
  'pfc', 'curve', 'rhythm', 'io',
]
// 补算顺序（X03）：慢的先行，避免快器官拿旧身体点火
const ORDER_COMP = [
  'hypothalamus', 'brainstem', 'endocrine', 'sickness', 'amygdala', 'rhythm',
  'dmn', 'hippocampus', 'neuromod', 'bias', 'social', 'attention',
  'insula', 'pfc', 'curve', 'io',
]

const DEFAULTS = {
  amygdala: { frame: 0, threat: 0.05, rewardPE: 0, novelty: 0, salience: 0.1, ne: 0.1, cort: 0.1, sensMax: 1, freeze: 0, kind: 'neutral', cue: '', context: {}, safety: {} },
  hypothalamus: { frame: 0, body: { hr: 70, hrv: 60, breath: 14, gut: 0, temp: 0, tension: 0.3, pain: 0 }, needs: {}, hpa: { cortisol: 0.15, ne: 0.1 }, rhythm: { energy: 0.6, moodBias: 0, thresholdShift: 0 }, sleepDebt: 0.2, bandwidthCap: 0.7, autonomic: { sym: 0.3, par: 0.6 }, hormones: {}, aggression: 0.1, cycle: { on: false, day: 14 }, stimulant: 0 },
  insula: { frame: 0, felt: { intensity: 0, qualities: [], location: '', precision: 0.5 }, disgust: 0, resonance: 0, mislabel: 0.2, craving: 0, wait: 0, risk: 0.2, bodySelf: 0.5, awareness: 0.5, bodyBudget: 1 },
  hippocampus: { frame: 0, recall: null, count: 0, encodes: 0, schemas: [], persons: {}, nostalgia: 0, recent: [] },
  pfc: { frame: 0, bandwidth: 0.6, cap: 0.8, load: 0.2, fatigue: 0.1, slots: 4, display: { mask: 0.3, toneShift: 'normal', brevity: 0.3, leakRisk: 0.2, rules: 0.7 }, attribution: { locus: 'circumstance', stability: 'temporary', globality: 'specific', blame: '环境', confidence: 0.5 }, reappraisal: { success: false }, conflict: 0, decision: {}, pfcGain: 0.5, repair: 0, regret: 0, labeling: 0, timePressure: 0 },
  neuromod: { frame: 0, ne: 0.3, da: 0.5, serotonin: 0.5, ach: 0.4, oxytocin: 0.35, vasopressin: 0.3, opioid: 0.3, endocannabinoid: 0.2, gain: 1 },
  attention: { frame: 0, gate: 1, focus: 0.4, salienceNet: 0.2, narrowing: 0, sticky: 0, onBody: 0.3, target: 'chat' },
  social: { frame: 0, selfOther: 0.7, mindRead: 0.5, affectiveEmpathy: 0.5, cognitiveEmpathy: 0.5, socialPain: 0, attachment: 'secure', status: 0.5, contagionOut: 0, empathyFatigue: 0, attitude: {}, trust: 0.6, otherFelt: 0, similarity: 0.6, comfort: 0, relationship: 'close', ledgerOpen: 0 },
  brainstem: { frame: 0, respiration: 14, heartRate: 70, arousal: 0.4, startle: 0, coupling: 0.5, freeze: 0 },
  dmn: { frame: 0, mindWander: 0, selfThought: 0.2, rumination: 0, mentalTime: 0.3, socialImagining: 0.2, idleMs: 0 },
  endocrine: { frame: 0, cortisol: 0.15, oxytocin: 0.35, estrogen: 0.5, testosterone: 0.5, thyroid: 0.6 },
  sickness: { frame: 0, inflammation: 0, fatigue: 0, withdraw: 0, hyperalgesia: 0 },
  curve: { frame: 0, phase: 'peak', intensity: 0.1, refractory: false, ambivalence: 0, secondPeak: 0 },
  rhythm: { frame: 0, weekly: 0, seasonal: 0, drift: 0, bias: 0 },
  bias: { frame: 0, neg: 0, hostile: 0, congruent: 0 },
  io: { frame: 0, brevity: 0.3, punctuation: 'normal', replyDelayMs: 0, memeTendency: 0.5, voice: { rate: 1, volume: 1 }, leak: 0, venting: 0, seekComfort: 0, selfReportGap: 0, labeled: 0 },
}

export function createEngine({ persona = {}, now = () => Date.now(), bridge = null, emit = null } = {}) {
  const p = { ...PERSONA_DEFAULT, ...persona }
  // 时钟兜底：外部传进来的 now 可能返回 NaN，存档里的 at 不能再被写成 NaN/null
  const clockNow = () => {
    try { const v = Number(now()); if (Number.isFinite(v)) return v } catch { /* 落到下面 */ }
    return Date.now()
  }
  const organs = {
    amygdala: amygdala(), hypothalamus: hypothalamus({ cycle: persona.cycle }), insula: insula(),
    hippocampus: hippocampus(), pfc: pfc(),
    neuromod: neuromod(), attention: attention(), social: social(),
    brainstem: brainstem(), dmn: dmn(), endocrine: endocrine(), sickness: sickness(),
    curve: curve(), rhythm: rhythm(), bias: bias(), io: output(),
  }
  const res = createResources()
  const state = {
    mood: p.moodBase, at: now(), ticks: 0, lastText: '', scene: 'home', gapMs: 0, humanGapMs: 0, other: 0,
    // grudge 0..1：关系账本的净重（长期项，随 snapshot 一起落盘）。
    // ledger：每次冒犯记一笔 {at, mass, kind}，按 7 天剪掉——记仇会淡，不是永久。
    grudge: 0, ledger: [], offense: null,
  }
  const trace = []
  const cache = new Map()
  const lastKnown = new Map()
  const seenEvents = new Map()
  // K07：有 eventId 的事件永久只算一次（跨拍重投也不许再算）
  const seenEventIds = new Set()
  // X10：锁着的时候进来的那一拍压在这里，出了锁补跑，不嵌套
  const waiting = []
  // X06：这一拍抛错被回滚的器官（帧末如实交出去）
  let frameFailed = []
  let fused = null
  let busy = false

  const world = {
    tx: null,
    get(id) { return cache.get(id) ?? lastKnown.get(id) ?? DEFAULTS[id] ?? null },
    res,
    limits: null,
    scene: 'home',
    mood: state.mood,
    gapMs: 0,
    other: 0,
    spoke: false,
    labeled: false,
    rng: () => 0.5,
    emotions: [],
    activity: '',
  }

  function stepOne(id, tx) {
    const m = organs[id]
    if (!m) return
    const before = safeSnapshot(m)
    try {
      m.step(world)
      const r = m.read()
      cache.set(id, r)
      lastKnown.set(id, r)
    } catch (e) {
      // X12：只回滚抛错的那个模块
      try { m.restore(before) } catch { /* ignore */ }
      if (!frameFailed.includes(id)) frameFailed.push(id)
      trace.push({ error: id, msg: String(e?.message || e) })
    }
  }

  function tick(events = [], sessionId = '') {
    // X10 单飞锁：锁着的时候绝不嵌套执行，但也不许把这一拍丢掉——压进 waiting，出了锁补跑
    if (busy) { waiting.push({ events, sessionId }); return fused }
    busy = true
    frameFailed = []
    try {
      const t1 = now()
      const dtMs = clamp(t1 - state.at, 0, 24 * 3600_000)
      // K07 幂等：同一条消息 30 秒内不重复计
      const uniq = []
      for (const e of events) {
        const eid = e?.eventId != null ? String(e.eventId) : ''
        if (eid) {
          if (seenEventIds.has(eid)) continue
          seenEventIds.add(eid)
          if (seenEventIds.size > 500) seenEventIds.clear()
          uniq.push(e)
          continue
        }
        const key = `${e.type}:${hash(String(e.text || ''))}`
        const last = seenEvents.get(key) || 0
        if (t1 - last < 30_000) continue
        seenEvents.set(key, t1)
        uniq.push(e)
      }
      if (seenEvents.size > 200) seenEvents.clear()
      const tx = { txId: `tx_${state.ticks + 1}`, t0: state.at, t1, dtMs, seed: 20261110 + state.ticks, events: uniq }
      // C08：间隔只对"对方的行为"计时，不把自己的延迟算进去
      // 把这一拍的对话转给记忆侧（宿主事件在 web 会话里没送达，只能从这条稳的路补）
      try {
        for (const ev of uniq) {
          if (!ev || !ev.text) continue
          bridge?.noteText?.(sessionId || ev.sessionId || '', ev.type, ev.text, ev.at)
        }
      } catch { /* 记忆侧不在就当没有 */ }

      // 只有"人话"才算她听见你了。宿主会把 runtime-context / 系统提醒 / 工具结果 /
      // 子 agent 的提示都标成 type==='user' 送进来（判据见 looksLikeHumanSpeech），
      // 以前这些也算"你说了一句"，于是没人说话 gapMs 也永远是 0——她的"等你多久了"从来没真的走过。
      const _heard = uniq.some(e => e.type === 'user' && looksLikeHumanSpeech(e.text))
      if (_heard) { state.gapMs = 0; state.lastUserAt = t1 }
      if (!state.lastHumanAt) state.lastHumanAt = Number(state.at || Date.now())
      if (!Number.isFinite(state.humanGapMs)) state.humanGapMs = 0
      else if (state.lastUserAt) state.gapMs = t1 - state.lastUserAt
      cache.clear()
      world.tx = tx
      // 场景按时间推断（A06 情境恐惧要用）
      const hr = new Date(t1).getHours()
      state.scene = hr >= 23 || hr < 6 ? 'night' : state.scene === 'night' ? 'home' : state.scene
      world.scene = state.scene
      // 对方状态：从这一轮的话里读（S03/S09/共情共振要用）
      state.other = uniq.some(e => /难受|崩溃|哭了|失眠|压力大|烦死|好累/.test(String(e.text || ''))) ? 0.7 : 0
      world.other = state.other
      // 这一拍用户说了什么，要在合成之前就让 fuse 看见：
      // 以前 lastUserText 是这一拍后半段才写进去的，导致"她对这句话的判断"总是晚一拍。
      // 只收人话（looksLikeHumanSpeech）：线上实测，宿主把每轮的 runtime-context 快照也当成
      // user/message 送进来，那段里本来就有她自己的口吻（"你叫大肥鱼…""委屈""被冷淡地顶了一下"），
      // 于是**没人说话**也每 2 分钟记一笔"冒犯"，mood 钉在 −0.6。
      // 判据不是"短才算话"：一句骂可以很长，被挡的只有系统/工具/助手那几类形状。
      const _u = uniq
        .filter((e) => e.type === 'user' && looksLikeHumanSpeech(e.text))
        .map((e) => String(e.text || ''))
        .join(' ')
        .trim()
      world.lastUserText = _u
      // 第二个计时器：只认这一拍真的有真人说话（_u 是本拍现算的，不是沿用的旧值）。
      // 消气按它算；gapMs 仍按原来的规则，C08 不动。
      if (_u) { state.humanGapMs = 0; state.lastHumanAt = t1 }
      else if (state.lastHumanAt) state.humanGapMs = t1 - state.lastHumanAt
      // 这一拍有没有"新的冒犯输入"：即时威胁的涨落、关系账本都按它分叉。
      // 量纲：on 是布尔；mass 0..1 是"这一句有多重"（越狠记的账越重）。
      // 注意"我自己累死了"不算冒犯：抱怨要冲着她说，或者带明确的刺。
      const _off = offenseOf(_u)
      state.offense = _off
      // 连续被冒犯的次数（30 分钟算一段）。第一次被扎是"扎一下"，
      // 连着第二、第三次才会真的顶成火——所以威胁的"拔高"按这一段来算，
      // 单次事件不制造一个假的高威胁（那会把"回多慢""话多短"整条链路带歪）。
      const _lastOffAt = Number(state.lastOffenseAt || 0)
      if (!_off.on || (t1 - _lastOffAt) > 30 * 60_000) state.offendStreak = _off.on ? 1 : 0
      else state.offendStreak = Math.min(6, Number(state.offendStreak || 0) + 1)
      if (_off.on) state.lastOffenseAt = t1
      world.offenseStreak = Number(state.offendStreak || 0)
      // 冒犯余温（0..1，12 分钟量级）：即时威胁很快落下去，但"刚被扎过"这件事
      // 还要在接下来几分钟里影响"这算不算一件事"——不然被骂完下一句，标签就凭空没了。
      // 它只影响情绪判断的门，不参与气氛打分（威胁仍然按 tauThreatMin 落）。
      state.offenseHeat = clamp(
        Number(state.offenseHeat || 0) * Math.exp(-(dtMs / 60_000) / 12) + (_off.on ? _off.mass : 0),
        0, 1,
      )
      world.offenseHeat = state.offenseHeat
      // 被指出做错、被反复返工：这一条以前完全不进评价，所以整晚返工她一点都不烦。
      const _fail = /不对|错了|还是不行|没修好|没生效|怎么又|说了几次|又错|骗我|糊弄|假\u7684|白改/.test(String(_u || ''))
      state.failStreak = _fail
        ? Math.min(4, Number(state.failStreak || 0) + 1)
        : Math.max(0, Number(state.failStreak || 0) * 0.5)
      // O11：她说出话来的那一拍，io 才有得读。以前这里直接清 0，而 io 是这一拍第一个跑的，
      // 于是 world.spoke 永远是 false、venting 永远是 0 —— "说出来了会轻一点"从来没发生过。
      world.spokeLast = world.spoke === true
      world.spoke = false
      // P19 命名只对"这一拍"成立：以前 world.labeled 从来没被置 1，也从没被复位，
      // 现在由 pfc 在命名那一拍置 1，每拍开头清掉，io.labeled 才是当拍的。
      world.labeled = false
      world.mood = state.mood
      world.gapMs = state.gapMs
      world.emotions = fused?.emotions ?? []
    stepOne('io', tx)
      // X04：抑制增益只对下一帧生效
      world.prevGain = lastKnown.get('pfc')?.display ? (lastKnown.get('pfc')?.pfcGain ?? 0.5) : 0.5
      const t0ms = Date.now()

      res.step(dtMs)
      world.rng = rng(tx.seed, 'pfc', state.ticks)
      world.limits = {
        inhibit: Math.min(res.read().total, res.read().sub.inhibit),
        attention: Math.min(res.read().total, res.read().sub.attention),
        empathy: Math.min(res.read().total, res.read().sub.empathy),
        will: Math.min(res.read().total, res.read().sub.will),
      }

      // A 段：先反应
      if (dtMs > 600_000) {
        stepOne('hypothalamus', tx)
        stepOne('brainstem', tx)
      }
      // 上下文：这句是新消息，但她的反应取决于最近几轮在说什么
      const lastUser = uniq.filter(e => e.type === 'user').slice(-1)[0]
      const currentFeatures = lastUser ? analyzeMessage(lastUser.text) : null
      if (currentFeatures && lastUser) {
        state.recent = [...(state.recent || []), { text: String(lastUser.text).slice(0, 60), at: t1, features: currentFeatures }].slice(-8)
        state.lastUserText = String(lastUser.text).slice(0, 60)
      }
      const context = buildContext(state.recent || [], currentFeatures || {})
      world.context = context
      // 多轮配对：上一问一答留着，才能"上一条说重了、这一条软一点"
      const lastAst = uniq.filter(e => e.type === 'assistant').slice(-1)[0]
      if (lastAst) state.lastAssistantText = String(lastAst.text ?? '').slice(0, 120)
      if (lastUser) {
        const prevUser = String(state.prevUserText || '')
        const prevAnswer = String(state.lastAssistantText || '')
        const txt = String(lastUser.text ?? '')
        world.pair = {
          prevUserLen: prevUser.length,
          nowUserLen: txt.length,
          prevAnswerLen: prevAnswer.length,
          shorter: prevUser.length > 0 && txt.length < prevUser.length * 0.6,
          softening: /对不起|抱歉|是我|我错|别生气|求你|好吧|算了/.test(txt),
          escalating: /又|还是|到底|说了几遍|怎么还|不是说了/.test(txt),
          answeredShort: prevAnswer.length > 0 && prevAnswer.length < 12,
        }
        state.prevUserText = txt.slice(0, 120)
      } else {
        world.pair = null
      }
      let memoryEcho = null
      if (bridge) {
        const qText = lastUser ? String(lastUser.text ?? '') : ''
        // 时间单位必须归一：消息带的 at 可能是秒，beforeMs 必须是毫秒。
        // 单位错了的后果很隐蔽——beforeMs 变成 1.7e9，而 episode.start 是毫秒（1.7e12），
        // "start >= beforeMs" 把**所有**旧事都滤掉，于是每一拍都是 empty-hits、回声永远空。
        const rawAt = lastUser ? Number(lastUser.at) : NaN
        const qAt = Number.isFinite(rawAt) ? (rawAt < 1e12 ? rawAt * 1000 : rawAt) : t1
        // 回声必须属于"这一句"。按**文字**认，不按时间戳认：
        // 同一句话重复出现时，上一拍异步捞到的结果应该能接着用；
        // 按时间戳认等于每说一遍都从零开始（异步永远追不上）。
        if (!lastUser || (state.memoryEchoCache && state.memoryEchoCache.queryText === qText)) {
          memoryEcho = state.memoryEchoCache || null
        }
        if (lastUser) {
          // 先试同步粗召回（记忆侧有 recallSync 时，这一拍就能用上，不再隔一拍）
          let fast = null
          try {
            // 不传 beforeMs：那本来只是"别把这一句自己捞回来"的优化，
            // 但记忆侧的时间轴和这里的 at 不保证同一把尺子，传错一次就把整库滤空
            // （实测就是：直接问命中 3 条，进真实对话永远 empty-hits）。
            // 这一句还没入 episode，不传也不会自己想起自己。
            fast = bridge.recallFast
              ? bridge.recallFast(lastUser.text, { valence: Number(fused?.valence ?? state.mood), arousal: Number(state.arousal) || 0, beforeMs: qAt - 1 })
              : null
          } catch { fast = null }
          if (fast && !fast.degraded && fast.hits?.length) {
            // 同步命中必须和这句话有字面重叠（记忆侧的 keep() 就是这么挡的）。
            // 假记忆不挡，这里补一道；降级的命中不参与这条规则。
            const qc2 = String(qText).replace(/[\s\p{P}]/gu, '')
            const grams2 = new Set()
            for (let i = 0; i + 1 < qc2.length; i += 1) grams2.add(qc2.slice(i, i + 2))
            const related = (h) => {
              const b = String(h?.brief || '')
              for (const g of grams2) if (b.includes(g)) return true
              return false
            }
            const kept2 = fast.hits.filter(related)
            if (!kept2.length) fast = null
            else fast = { ...fast, hits: kept2 }
          }
          if (fast && fast.hits?.length) {
            const ranked = bridge.moodRerank
              ? bridge.moodRerank(fast.hits, Number(fused?.valence ?? state.mood), { degraded: fast.degraded })
              : fast.hits
            const tone = ranked.reduce((s, h) => s + (Number(h.valence) || 0), 0) / ranked.length
            // 回声轮换：命中集往往稳定（BM25 头部永远是那几条旧事），
            // 直接取前 3 会让"记忆回声"几个月不变。给它一个游标，
            // 每条新消息从下一名开始取 3 条 —— 都是相关的，但不会僵在同一组。
            const rot = Number(state.echoCursor || 0) + 1
            state.echoCursor = rot
            const n = ranked.length
            const rotated = n > 3
              ? Array.from({ length: n }, (_, i) => ranked[(rot + i) % n])
              : ranked
            state.memoryEchoCache = { hits: rotated.slice(0, 3), tone, degraded: fast.degraded, valenceReady: fast.valenceReady, source: 'sync', at: t1, queryAt: qAt, queryText: qText }
            memoryEcho = state.memoryEchoCache
          } else if (!(state.memoryEchoCache && state.memoryEchoCache.queryText === qText)) {
            // 这一句真的没想起什么：清掉旧的，别拿上一句冒充。
            // 但如果缓存正是**这一句**异步捞回来的，不能清。
            state.memoryEchoCache = null
          }
          // empty-hits 是"确实想不起来"的确定结论：这时不许再拿异步兜底，
          // 否则松散检索会把不相关的事塞进这一句，等于给她安错记忆。
          const stage = bridge.fastStage ? bridge.fastStage() : null
          // 同步那条路"降级/没装/出错"时，它返回空不等于"想不起来"，这时才退回异步。
          // 反过来：stage==='empty-hits' 是记忆侧**确定**的"这一句想不起什么"
          // （它用字面重叠做硬检查防编造），这时绝不能拿异步的松散结果顶上，
          // 否则任何一句话都会被塞进同一组旧事——面板看起来就"永远那三条"。
          const degraded = !fast || fast.degraded === true || stage == null ||
            stage === 'ok-false' || stage === 'degraded' || stage === 'index-not-loaded' || stage === 'threw'
          if (stage !== 'empty-hits' && degraded) {
            try {
              Promise.resolve(bridge.recallAsync ? bridge.recallAsync(lastUser.text) : bridge.recall(lastUser.text))
                .then(hit => {
                  // 同步已经拿到结果就别覆盖：异步只是兜底。
                  // 抢着覆盖等于把同拍结果又降回"隔一拍"。
                  if (!hit || state.memoryEchoCache?.source === 'sync') return
                  state.memoryEchoCache = { ...hit, source: 'async', at: t1, queryAt: qAt, queryText: qText }
                }).catch(() => {})
            } catch { /* 忽略 */ }
          }
          try {
            const s = bridge.salience(lastUser.text)
            if (s != null) world.memorySalience = s
          } catch { /* 忽略 */ }
        }
      }
      // 每 10 拍拉一次"最近记忆里发生了什么"（只读 episodes，异步，不阻塞这一拍）
      if (bridge && state.ticks % 10 === 0 && typeof bridge.recentEpisodes === 'function') {
        Promise.resolve(bridge.recentEpisodes(6, 5)).then(list => { if (list) state.memoryRecent = list }).catch(() => {})
      }
      world.memoryEcho = memoryEcho
      // 本拍同步没拿到、但异步在同一拍里回来了（或上一拍留下的同一句还没用过）：
      // 读的时候再取一次。以前异步结果只写进 cache，从没被读出去过。
      if (!world.memoryEcho && state.memoryEchoCache?.hits?.length) {
        world.memoryEcho = state.memoryEchoCache
      }
      // 图式：从记忆皮层挑几条高置信度的概念，当作"她已经认定了的事"。
      // 以前这一格只看心情自己的本地 schemas（要同一个 cue 攒够 3 次），
      // 事实上永远不会出现 —— 面板上那行就永远是 —。
      if (bridge && typeof bridge.schemas === 'function') {
        const qs = lastUser ? String(lastUser.text ?? '') : String(state.lastUserText || '')
        try {
          const sc = bridge.schemas(qs, 3)
          if (Array.isArray(sc)) world.memorySchemas = sc
          // 诊断要和取数同一个实例，否则面板会读到另一个 bridge 的空调试
          if (typeof bridge.schemaDebug === 'function') world.memorySchemaDebug = bridge.schemaDebug()
        } catch { /* 图式取不到不影响这一拍 */ }
      }
      world.memoryRecent = state.memoryRecent || null
      // ── 记忆回声对**器官**的输入要按新旧打折 ──────────────────────────
      // 杏仁核拿到 hits 就 threat += 0.12×负性，而回声在安静的时候也每拍都挂着：
      // "一直想起同一件旧事"于是变成一台每分钟 +0.12 的水泵，威胁永远贴着 1。
      // 这里用引擎已经在算的 echoPull（一半原始 tone、一半"跟最近比新不新"）喂器官；
      // 面板上 fused.memoryEcho 仍是原始 tone（下面 fused.memoryEcho = memEchoCtx），不改展示。
      const canEncode = organs.hippocampus.read()?.encodes !== false
      const memEchoCtx = canEncode ? memoryEcho : null
      const echoTone = clamp(Number(memEchoCtx?.tone ?? 0) || 0, -1, 1)
      const echoEma = clamp(Number(state.echoToneEma ?? 0) || 0, -1, 1)
      const echoNovel = clamp(echoTone - echoEma, -1, 1)
      // EMA 也按分钟走（0.9^分钟）：2 秒一拍的面板轮询不会把它 30 倍地抹平。
      const _echoDtMin = clamp(dtMs / 60_000, 0, 60)
      state.echoToneEma = memEchoCtx
        ? clamp(echoEma + (echoTone - echoEma) * 0.34, -1, 1)
        : clamp(echoEma * Math.pow(0.9, _echoDtMin), -1, 1)
      // 回声的新鲜度：同一份回声（同一句问话）挂得越久，拽得越轻。
      // 量纲：0..1 的乘子，15 分钟掉到 1/e；消息那一拍 age=0，乘子 1（和改造前完全一样）。
      const _echoAt = Number(memEchoCtx?.at)
      const _echoAgeMin = memEchoCtx && Number.isFinite(_echoAt) ? Math.max(0, (t1 - _echoAt) / 60_000) : 0
      const echoFresh = memEchoCtx ? Math.exp(-_echoAgeMin / Math.max(1, Number(p.echoFreshMin ?? 15))) : 0
      const echoPull = memEchoCtx ? clamp((0.5 * echoTone + 0.5 * echoNovel) * echoFresh, -1, 1) : 0
      world.echoPull = echoPull
      world.memoryEcho = memEchoCtx ? { ...memEchoCtx, tone: echoPull, toneRaw: echoTone } : memEchoCtx
      try {
        organs.amygdala.fast(world)
      } catch (e) {
        trace.push({ error: 'amygdala.fast', msg: String(e?.message || e) })
      }
      cache.set('amygdala', organs.amygdala.read())
      lastKnown.set('amygdala', cache.get('amygdala'))

      // ── 冒犯当场：即时威胁朝 1 顶一格（升得快）──────────────────────
      // 量纲：threat 0..1；_spike 是"朝 1 走多远"的比例（0.30~0.66），不是加法。
      // 记仇（state.grudge 0..1）在这里给一点放大：有过前科的人，同一句更顶。
      // 这一笔只顶"现在"，"以后"由关系账本负责——两件事分开记。
      if (_off.on) {
        const _a = safeSnapshot(organs.amygdala)
        if (_a) {
          // 第一次被扎：不额外拔高（器官自己那一下就是"扎了一下"，实测延迟/句长整条链都按它标过）；
          // 连着第二、第三次才真的"火起来"：ramp 0 → 0.5 → 1。
          const _ramp = clamp((Number(state.offendStreak || 1) - 1) / 2, 0, 1)
          const _spike = p.threatSpike * _ramp * (0.55 + 0.45 * clamp(_off.mass, 0, 1)) * (1 + 0.25 * clamp(state.grudge, 0, 1))
          const _th0 = clamp(Number(_a.threat ?? 0), 0, 1)
          _a.threat = clamp(_th0 + (1 - _th0) * clamp(_spike, 0, 0.95), 0, 1)
          _a.fastThreat = _a.threat
          try { organs.amygdala.restore(_a) } catch { /* 单器官失败不影响这一拍 */ }
          cache.set('amygdala', organs.amygdala.read())
          lastKnown.set('amygdala', cache.get('amygdala'))
        }
        // 关系账本：一次冒犯一笔。即时威胁走完就走完了，账本留下来（记仇，但不会钉死 threat）。
        state.ledger = [...(state.ledger || []), {
          at: t1, mass: r3(clamp(_off.mass, 0, 1)),
          kind: _off.hard ? '重话' : _off.cold ? '冷落' : '脾气',
        }].slice(-16)
        state.grudge = clamp(Number(state.grudge || 0) + p.grudgePerOffense * clamp(_off.mass, 0, 1), 0, 1)
      } else if (/对不起|抱歉|是我说重|我错了|别生气|别往心里去/.test(String(world.lastUserText || ''))) {
        // 道歉不是"没记过"：账本减一档，但不归零。人不会一句对不起就当没发生。
        state.grudge = clamp(Number(state.grudge || 0) * 0.75, 0, 1)
      }

      // ── 事件级的"安全经历"（A07 消退，补在引擎层）───────────────
      // 杏仁核只在道歉时学"这条线索没危险"（amygdala.fast 里的 apology 分支）；
      // 于是被夸一百次也压不下威胁。而威胁一旦被顶到 1，融合层就把它读成"这一句不顺"，
      // 连"吃到好吃的"都判成委屈（线上实测：三句好话把 threat 从 0.21 顶到 0.72）。
      // 这里按"这一整句是不是明确的好事"给一次消退：
      //   threat ×0.72 —— 一次好话压掉 28%，与道歉的 0.85×pfcGain 同量级但更弱；
      //   frustration ×0.6、ne ×0.8 —— 被真扎过后那股劲松一档；
      //   反刍/念头黏住 ×0.7 —— 好事能打断反刍，不是只有"时间过去了"才行。
      // 只改这一帧的器官状态，并同步 cache，让同一帧的融合和下一帧的器官都读得到。
      try {
        const _saidNow = String(world.lastUserText || '')
        if (_saidNow && positiveEvent(_saidNow) && !analyzeMessage(_saidNow).complaint) {
          const _a = safeSnapshot(organs.amygdala)
          if (_a) {
            _a.threat = clamp(Number(_a.threat ?? 0) * 0.72, 0, 1)
            _a.frustration = clamp(Number(_a.frustration ?? 0) * 0.6, 0, 1)
            _a.ne = clamp(Number(_a.ne ?? 0) * 0.8, 0, 1)
            // 敏化也要褪：A05 的 sens 只在"别的线索怕过"时泛化（A11 gen = 0.25×(sens-1)），
            // 而 gen 对任何带线索的话都生效（连"热"也算），于是被骂过几次以后，
            // 一句夸奖也能把 threat 顶回去（实测：三句好话 0.21→0.72）。
            // 被善待的时候，之前的敏化就该慢慢回 1：系数 0.85/次，约五次好话褪一半。
            if (_a.sens && typeof _a.sens === 'object') {
              const _sens = {}
              for (const [k, v] of Object.entries(_a.sens)) _sens[k] = Math.max(1, Number(v) * 0.85)
              _a.sens = _sens
            }
            try { organs.amygdala.restore(_a) } catch { /* 单个器官失败不影响这一拍 */ }
            cache.set('amygdala', organs.amygdala.read())
            lastKnown.set('amygdala', cache.get('amygdala'))
          }
          for (const [id, key, keep] of [['dmn', 'rumination', 0.7], ['attention', 'sticky', 0.7]]) {
            const _o = organs[id]
            if (!_o?.snapshot || !_o?.restore) continue
            const _s = safeSnapshot(_o)
            if (!_s || !(Number(_s[key]) > 0.02)) continue
            _s[key] = clamp(Number(_s[key]) * keep, 0, 1)
            try { _o.restore(_s) } catch { /* 同上 */ }
            cache.set(id, _o.read())
            lastKnown.set(id, cache.get(id))
          }
        }
      } catch { /* 消退失败不影响这一拍 */ }

      // B 段：后解释
      const hipBefore = lastKnown.get('hippocampus')?.count ?? 0
      const order = dtMs > 600_000 ? ORDER_COMP : ORDER_B
      for (const id of order) {
        if (dtMs > 600_000 && (id === 'hypothalamus' || id === 'brainstem')) continue
        stepOne(id, tx)
      }

      // X08：情景延迟落库（等归因出来再提交）
      for (const m of Object.values(organs)) { try { m.commit?.() } catch { /* 单个失败不影响 */ } }

      // 时间过去：几个"慢变量"也要松一档。
      // 它们原来只在有事件时被驱动，安静下来就永远卡在 100（戒备/反刍/念头黏住），
      // 连带着心情一直被按在低位。这里按 dt 衰减，没消息的时候也会慢慢回落。
      try {
        const relax = 1 - Math.exp(-(dtMs / 60_000) / 10) // 10 分钟量级（主人指定的手感）
        const loose = [
          ['social', { trust: 0.6 }],
          ['attention', { sticky: 0 }],
          ['dmn', { rumination: 0 }],
        ]
        for (const [id, targets] of loose) {
          const organ = organs[id]
          if (!organ?.snapshot || !organ?.restore) continue
          const snap = organ.snapshot()
          let touched = false
          for (const [key, goal] of Object.entries(targets)) {
            const cur = Number(snap?.[key])
            if (!Number.isFinite(cur)) continue
            const next = cur + (goal - cur) * relax * 0.5
            if (Math.abs(next - cur) > 1e-4) { snap[key] = next; touched = true }
          }
          if (touched) organ.restore(snap)
        }
      } catch { /* 衰减失败不影响这一拍 */ }

      // ── 没有新的冒犯输入：即时威胁按分钟级回落（这一条以前根本不存在）──────
      // 三件事一起做，缺一件 threat 都降不下来：
      //   1) 急性衰减 exp(-Δt/tau)，tau 8 分钟，被记仇拉长到最多 12 分钟（有前科的人缓得慢一点）；
      //   2) 那股"被怼的劲"（frustration 会把触发阈值压到 0.5，等于同一句话扎得更重）也松，
      //      tau 20 分钟——器官自己只有 30 分钟，且每轮又被喂回去，实测能卡在 0.998；
      //   3) 情境恐惧的托底（A06，最高 0.2）**留着**：那是"这个场景让我更警觉"的长期戒备，
      //      不是"还在气头上"。威胁落到底就停在那儿，0.12 以下本来也不被算成"这句不顺"。
      if (!_off.on) {
        try {
          const _dtMin = Math.max(0, dtMs / 60_000)
          const _a = safeSnapshot(organs.amygdala)
          if (_a) {
            let _touched = false
            const _th = Number(_a.threat)
            // 情境恐惧（A06）的托底：它是"在怕过的场景里更容易被点着"的长期戒备（最高 0.2），
            // 是记仇，不是"还在气头上"。即时威胁只衰减到这条线为止，不往下压。
            // （不这么做的话，十分钟一拍的安静会把托底也乘掉，夜里那点戒备就凭空消失了。）
            const _ctxMass = _a.context && typeof _a.context === 'object'
              ? Number(_a.context[String(state.scene || 'home')] ?? 0)
              : 0
            // 托底最高 0.18：A06 要的是"夜里那个场景会让她紧一下"（≥0.15），
            // 但再往上就等于"永远还有点生气"——0.18 是"戒备"，不是"气还没消"。
            const _floor = clamp(Number(organs.amygdala.params?.contextFloor ?? 0.2) * _ctxMass, 0, 0.18)
            if (Number.isFinite(_th) && _th > 0) {
              // 安静期的"消气"：超过 quietAfterMin（3 分钟）没有新的用户消息，才算真的安静下来，
              // 这时高出地板的那一截按 tauQuietMin（12 分钟）退；3 分钟以内的停顿是同一轮对话的换气，
              // 不加这一层（否则"一句道歉之后一分钟"会被安静期的衰减抢走，A07 量到的就不是道歉的效果）。
              // 两条衰减都按时间算：exp(-Δt/tau)，2 秒一拍和 60 秒一拍结果一样。
              const _quietMin = Math.max(0, Number(state.humanGapMs || 0) / 60_000)
              const _quiet = !String(world.lastUserText || '') && _quietMin >= Number(p.quietAfterMin ?? 3)
              const _dec = _quiet ? Math.exp(-_dtMin / Math.max(1, Number(p.tauQuietMin ?? 12))) : 1
              // 托底：A06 情境恐惧（上限 0.18）不往下压——那是"这个场景让我警觉"的长期戒备，
              // 不是"还在气头上"。
              _a.threat = clamp(_floor + Math.max(0, _th - _floor) * _dec, 0, 1); _touched = true
              // 逐拍埋点（仅当 DSH_AFFECT_TRACE=1 时写文件）：定位"谁在抬威胁"用，不影响行为。
              if (process.env.DSH_AFFECT_TRACE === '1') {
                try { fsTrace.appendFileSync('E:/brain/_threat_trace.log', `${Date.now()} th=${_a.threat.toFixed(3)} pre=${Number(_th).toFixed(3)} floor=${_floor.toFixed(3)} dec=${_dec.toFixed(3)} quiet=${_quiet ? 1 : 0} user=${world.lastUserText ? 1 : 0} echo=${world.memoryEcho ? 1 : 0} fr=${Number(_a.frustration || 0).toFixed(3)}\n`) } catch { /* ignore */ }
              }
            }
            const _fr = Number(_a.frustration)
            if (Number.isFinite(_fr) && _fr > 0) {
              _a.frustration = clamp(_fr * Math.exp(-_dtMin / Math.max(1, p.tauThreatMin * 2.5)), 0, 1); _touched = true
            }
            // 情境恐惧（A06）的托底**不动**：它是"在怕过的场景里更容易被点着"的
            // 长期戒备，最高 0.2，本来就该留着（那是记仇，不是"还在气头上"）。
            // 即时威胁的衰减只作用在托底以上的那一截，落到底就停。
            if (_touched) {
              try { organs.amygdala.restore(_a) } catch { /* ignore */ }
              cache.set('amygdala', organs.amygdala.read())
              lastKnown.set('amygdala', cache.get('amygdala'))
            }
          }
          // 反刍/念头黏住也跟着松：脑子里转个不停的，不该比身上那股劲还久。
          // （原来 dmn 每拍 +0.02/分钟 自己喂自己，tau 30 分钟，实测长期 0.5 以上。）
          for (const [id, key, tau] of [['dmn', 'rumination', 25], ['attention', 'sticky', 20]]) {
            const _o = organs[id]
            const _s = _o?.snapshot ? safeSnapshot(_o) : null
            if (!_s || !(Number(_s[key]) > 0)) continue
            _s[key] = clamp(Number(_s[key]) * Math.exp(-_dtMin / tau), 0, 1)
            try { _o.restore(_s) } catch { /* ignore */ }
            cache.set(id, _o.read())
            lastKnown.set(id, cache.get(id))
          }
        } catch { /* 冷却失败不影响这一拍 */ }
      }
      // 账本按小时淡（48 小时半衰）：记仇不是永久，也不是十几分钟就原谅。
      if (dtMs > 0) {
        state.grudge = clamp(Number(state.grudge || 0) * Math.exp(-(dtMs / 3600_000) / Math.max(1, p.grudgeTauH)), 0, 1)
        const _cut = t1 - 7 * 86400_000
        state.ledger = (state.ledger || []).filter((l) => Number(l.at) >= _cut)
      }

      // ── 记忆回声对底色的拉力：上面已经算好（echoPull，含"新不新"），这里只留一句说明 ──
      // 想起旧事会拽一下心情，但"一直想起同一件坏事"不该等于每句话都扣一次。
      // 第一次想起旧伤，拽得动；连着十次想起同一件事，只剩一点余味。

      state.ticks += 1
      state.at = Number.isFinite(t1) ? t1 : clockNow()
      world.prevEmotions = state.prevEmotions || []
      world.grudge = Number(state.grudge || 0)
      fused = fuse(world, state.mood, p)
      // J08 缺模块不假装：这一拍哪些器官根本不在（被摘掉/没装上），要如实交出去，
      // 注入据此把"身体""身上"那几行收起来。不许拿一个空对象冒充它还在。
      const missingNow = Object.keys(organs).filter((id) => !organs[id])
      for (const id of frameFailed) if (!missingNow.includes(id)) missingNow.push(id)
      fused.missing = missingNow
      // 中性话这一拍：留着的情绪只是余温，标在最终返回对象上（fuse 内部标的是局部数组）
      try {
        const u = String(world.lastUserText || '')
        const neutralTurn = u.length > 0 && !/烦|累死|崩溃|垃圾|废物|重写|谢谢|厉害|棒|辛苦|真是绝了|你可真行|呵呵|好家伙|抱歉|对不起|我说重了/.test(u)
        if (neutralTurn && Array.isArray(fused.emotions)) {
          fused.emotions = fused.emotions.map((e) => ({ ...e, from: 'linger' }))
        }
      } catch { /* 标记失败只影响"新/旧"判定 */ }
      // io 在 fuse 之前跑，表情包拿的是上一拍的情绪；这里用当拍情绪补算一次，
      // 否则"被骂那一拍还在按旧情绪挑表情"。
      try {
        world.emotions = fused?.emotions ?? []
        stepOne('io', tx)
        // 让注入和面板读到的表情包跟 io 当拍的值一致（之前注入拿的是上一拍的 meme）
        const ioNow = organs.io?.read?.()
        if (ioNow) {
          fused.io = ioNow
          if (ioNow.meme) fused.meme = ioNow.meme
        }
        // O04-O07/O12：这一拍的表达细则（措辞三档 / 一句多少字 / 标点画像 / 憋着的时长 / 要不要开口）
        const detail = organs.io?.detail?.()
        if (detail) fused.out = detail
        // O11 表达后的释放：她真的把话说出来了，这一拍情绪和体内感就轻一档（至少 10%）。
        // 以前 world.spoke 在 io 读到之前就被清掉，venting 恒为 0，"说完会轻一点"从没发生过。
        const vent = clamp(Number(detail?.venting ?? world.get('io')?.venting ?? 0), 0, 1)
        if (world.spokeLast === true && vent > 0.15) {
          const drop = clamp(0.12 + 0.25 * vent, 0, 0.3)
          if (Array.isArray(fused.emotions)) {
            fused.emotions = fused.emotions.map(e => ({ ...e, intensity: clamp(Number(e.intensity ?? 0) * (1 - drop), 0, 1) }))
          }
          const insSnap = safeSnapshot(organs.insula)
          if (insSnap && Number.isFinite(Number(insSnap.intensity))) {
            insSnap.intensity = clamp(Number(insSnap.intensity) * (1 - drop), 0, 1)
            organs.insula.restore(insSnap)
            fused.felt = { ...(fused.felt || {}), intensity: insSnap.intensity }
          }
        }
      } catch { /* 补算失败就沿用上一拍，不影响其他器官 */ }

      // F01/F03/F04：病感得算进"这一拍"，不能只靠 fuse 里那个 -0.1×炎症 的慢积分
      // （时间尺度是小时，生病要几小时才看得见；痛感更是根本没有通路）。
      const _sickNow = organs.sickness.read()
      const _ill = clamp(Number(_sickNow?.inflammation ?? 0), 0, 1)
      const _prevIll = clamp(Number(state.prevIll ?? 0), 0, 1)
      state.prevIll = _ill
      if (_ill > 0.02) {
        const _fat = clamp(Number(_sickNow?.fatigue ?? 0), 0, 1)
        const _wd = clamp(Number(_sickNow?.withdraw ?? 0), 0, 1)
        const _hg = 1 + 0.4 * clamp(Number(_sickNow?.hyperalgesia ?? 0), 0, 1)   // F04 ×1.4 上限
        fused.valence = clamp(Number(fused.valence ?? 0) - 0.55 * _ill, -1, 1)   // F01 当场就往下走
        fused.moodTarget = clamp(Number(fused.moodTarget ?? 0) - 0.20 * _ill - 0.08 * _fat, -1, 1)
        // 病的"起势"是当场的事：一下子烧起来，心情先掉一截，剩下的交给慢积分。
        // 只在变重时给，不按拍累加——不然病一天能把心情按到地板。
        const _jump = _ill - _prevIll
        if (_jump > 0.12) state.mood = clamp(state.mood - 0.12 * _jump, p.moodBase - p.moodCap, p.moodBase + p.moodCap)
        // F03 不想聊：话更短（inject 那句"不想多说话"读的是 fused.withdraw）
        fused.io = { ...(fused.io ?? {}), brevity: clamp(Number(fused.io?.brevity ?? 0.3) + 0.25 * _wd, 0, 1) }
        // F04 痛觉敏化：同强度的痛，病中更疼；复制一份，别改脏器官那一帧的 read()
        if (fused.body && Number.isFinite(Number(fused.body.pain))) {
          fused.body = { ...fused.body, pain: clamp(Number(fused.body.pain) * _hg, 0, 1) }
        }
      }

      // 记忆对心情的影响：想起的事会拽一下底色（只拽一点，不许翻盘）
      // 返工累积：越被反复指出做错，越烦；这条直接进情绪表，面板上看得见
      const _fs = Number(state.failStreak || 0)
      if (_fs >= 1) {
        const tone = Math.min(0.45, 0.12 * _fs)
        fused.valence = clamp(Number(fused.valence || 0) - tone * 0.35, -1, 1)
        fused.moodTarget = clamp(Number(fused.moodTarget || 0) - tone * 0.5, -1, 1)
        if (_fs >= 2) {
          const list = Array.isArray(fused.emotions) ? fused.emotions.slice() : []
          // 用原型表里的'厌烦'，不要自己造一个'烦'：
          // 注入和统计都按 NEG_KINDS 判正负，'烦'不在表里，结果被当成正面写成"心里是松的，有点烦"。
          list.unshift({ kind: '厌烦', intensity: Math.min(0.8, 0.35 + 0.15 * _fs), from: 'rework' })
          fused.emotions = list.slice(0, 3)
        }
      }

      // 没编码进来，就不该"想起"旧事：回声要过海马这道门
      if (memEchoCtx) {
        fused.memoryEcho = memEchoCtx
        fused.echoPull = echoPull
      }
      // 多轮配对跟记忆无关：没想起旧事，也得知道上一句刚说过什么
      fused.pair = world.pair || null
      state.prevEmotions = (fused.emotions || []).slice(0, 2).map(e => ({ kind: e.kind, intensity: e.intensity }))

      // X08：这一帧的情绪标签盖到刚编码的那条情景上。以前只在桥接了 announce 时才盖，
      // 于是没接记忆侧（或只接了 noteText）时，落库的情景 kind 永远是「-」。
      if (organs.hippocampus.read().count > hipBefore) {
        organs.hippocampus.stampLast?.({ kind: fused.emotions?.[0]?.kind })
      }
      // 回告记忆侧 + 情绪写回：必须在 fuse 之后。
      // 编码那一步（hippocampus.step）里的 w.emotions 是上一帧的 fused，
      // 所以账本里的 kind 要么空、要么是上一句的标签。这里用"这一帧"的情绪盖章。
      if (bridge && typeof bridge.announce === 'function') {
        const nowCount = organs.hippocampus.read().count
        if (nowCount > hipBefore) {
          const emo = fused.emotions?.[0] ?? null
          const ep = organs.hippocampus.stampLast?.({ kind: emo?.kind })
            ?? organs.hippocampus.snapshot().episodes.slice(-1)[0]
          const brief = String(ep?.triggerBrief ?? '')
          bridge.announce?.({ at: ep?.at, valence: ep?.valence ?? 0, intensity: ep?.intensity ?? 0, brief }, emit)
          try {
            const moodNow = Number(state.mood) || 0
            const emoValence = Number(ep?.valence) || 0
            // 人格的先验（第四条桥）：只说"这件事该记得多深"。
            // 拿不到就 null，按原来的算——不许拿 0 假装"没有偏好"。
            const prior = typeof bridge.personaPrior === 'function' ? bridge.personaPrior() : null
            const bias = prior ? Number(prior.deepBias) || 0 : 0
            const deepen = 1 + 0.4 * Math.max(0, -emoValence) + 0.45 * bias
            const base = Number(ep?.intensity) || 0
            const kind = String(ep?.kind ?? '')
            // 两件事分开：
            //   说不出名字但当时确实被戳到了 → 记，named:false
            //   连"被戳到"的量都没有（效价近 0、强度也低）→ 不记
            // 以前一律记，账本里六成是"有情绪：说了几句话"，统计全被稀释。
            const notable = Math.abs(emoValence) >= 0.15 || base >= 0.35
            // 记忆深度：情绪本身够重，或者人格认为"这种事她放不下"
            const deep = deepen > 1.1 || (bias > 0.75 && Math.abs(emoValence) >= 0.2)
            if (kind || notable) {
              bridge.annotate?.({
                kind,
                valence: ep?.valence ?? 0,
                intensity: clamp(base * deepen, 0, 1.6),
                depth: deep ? 'deep' : 'normal',
                mood: Number(moodNow.toFixed(3)),
                brief,
                prior: prior ? bias : null,
              }, sessionId)
            }
          } catch { /* 写不进去不影响心跳 */ }
        }
      }

      // ── 心情积分（慢变量 + 当场冲量）──────────────────────────
      // 两个时间尺度，分开算，别混在一起：
      //   1) 当场：这一拍的评价（eventValence，-1..1）折成心情冲量。
      //      量纲：valence=+0.6 的一句"真好" → +0.6×0.20 ≈ +0.12 心情。这就是"被夸会飘一下"。
      //      正 0.20 / 负 0.26：负性略重（坏消息本来就扎得深），但不是 10:1 的不讲理。
      //   2) 慢变量：朝 moodTarget 以 tauMoodH 小时回（默认 1.25h）。冲量最终会被这一步收回去。
      // 以前为什么回不来：冲量只有 0.03×ev（≈0.02），而慢积分常数是 45 分钟——
      //   正面能量还没攒起来就被抽走；同时负面每拍 -0.05，威胁又被钉死在 1。
      const k = 1 - Math.exp(-(dtMs / 60_000) / (p.tauMoodH * 60))
      state.mood = state.mood + (fused.moodTarget - state.mood) * k
      if (lastUser) {
        // 用"这一拍整句好不好"（eventValence），不含回底项——
        // 回底是慢积分的事，放进冲量等于"因为心情低，所以每句话都自动加分"，会把真正的坏事抵掉。
        const ev = clamp(Number(fused.eventValence ?? fused.valence ?? 0) || 0, -1, 1)
        // 只有"明确事件"（被夸/好事/被骂/被刺）才全量冲；中性或只是冷一点的一拍打 0.55 折。
        // 不然连说十句"随便吧"等于被骂十次（实测 40 分钟掉 0.5），那不是人，是积分器。
        const _tf = analyzeMessage(String(lastUser.text ?? ''))
        const explicitTurn = positiveEvent(String(lastUser.text ?? '')) || _tf.complaint || _tf.praise
        if (Math.abs(ev) > 0.05) {
          // 饱和：已经到底/到顶时，同样一件事再抬/再压也不动那么多了。
          // room 是"还剩多少空间"（0..1，除以 moodCap 归一），量纲和 imp 一致。
          // 这不是宽容：负数一侧的系数本来就更大（0.26 vs 0.20），深处还是疼，只是不再一刀切到底。
          const room = ev >= 0
            ? (p.moodBase + p.moodCap - state.mood) / Math.max(1e-6, p.moodCap)
            : (state.mood - (p.moodBase - p.moodCap)) / Math.max(1e-6, p.moodCap)
          const imp = (ev >= 0 ? 0.30 : 0.26) * (explicitTurn ? 1 : 0.55) * (0.35 + 0.65 * clamp(room, 0, 1))
          state.mood = state.mood + ev * imp
          // 被明确哄好：除了这一下的冲量，还要把"低于底色"的那一段往回带一档。
          // 量纲同 mood（-1..1），系数 0.10 是"这一句让我松了一成"，不是跳到头顶。
          if (ev > 0 && explicitTurn && state.mood < p.moodBase) {
            state.mood += (p.moodBase - state.mood) * 0.10
          }
        }
      }
      // ── 缓过来：威胁下来了、这一拍也没有新的冒犯/抱怨 ─────────────────
      // 只抬"低于底色"的那一段（tau 40 分钟，见 tauCalmMin），高于底色的照旧慢慢落。
      // 这一条和 tauMoodH（1.25h）分工：tauMoodH 管"朝目标值收敛"的慢线，
      // 这一条管"被扎下去以后多久爬回底色"——实测贴地板那阵子，慢线一个人要 2 小时以上。
      {
        const _thNow = clamp(Number(organs.amygdala.read()?.threat ?? 0), 0, 1)
        const _plain = !_off.on && !(lastUser && analyzeMessage(String(lastUser.text ?? '')).complaint)
        if (_plain && _thNow < clamp(Number(p.calmThreatGate ?? 0.85), 0, 1)) {
          const _below = Math.max(0, p.moodBase - state.mood)
          if (_below > 1e-4) state.mood += _below * (1 - Math.exp(-(dtMs / 60_000) / Math.max(1, p.tauCalmMin)))
        }
      }
      state.mood = clamp(state.mood, p.moodBase - p.moodCap, p.moodBase + p.moodCap)
      // 回写：注入文本和仪表页读的都是 fused.mood。不回写的话它们拿到的是**上一拍**的心情，
      // 于是"这句话让我好受了一点"永远晚一条消息才看得见（也是 cycle50 那条假警报的来源：
      // 第 23 条大跌，却算在第 24 条"辛苦了"头上）。
      fused.mood = state.mood

      trace.push({
        txId: tx.txId, dtMs, mood: r3(state.mood), valence: r3(fused.valence),
        emotion: fused.emotions[0]?.kind ?? '-', ms: Date.now() - t0ms,
        stale: cache.size < Object.keys(organs).length,
        missing: fused.missing,
      })
      if (trace.length > 200) trace.shift()
      return fused
    } finally {
      busy = false
      // X10：锁着的时候压进来的那几拍，出锁后按顺序补跑（外层那一拍已经算完了，不嵌套）
      if (waiting.length) {
        const next = waiting.shift()
        try { tick(next.events, next.sessionId) } catch { /* 排队那拍失败不影响外层 */ }
      }
    }
  }

  function text({ hour } = {}) {
    if (!fused) tick()
    // 同一拍内只渲染一次：否则同一轮里第二次渲染会误判成"重复"，加上"还是那样"
    if (state.renderTick === state.ticks && state.renderText) return state.renderText
    const h = hour ?? new Date(state.at).getHours()
    const t = render(fused, { hour: h, lastLine: state.lastText, world, tick: state.ticks })
    state.lastText = t.split('\n')[0] || ''
    state.renderTick = state.ticks
    state.renderText = t
    return t
  }

  function snapshot() {
    // at 必须是真的时间戳：不然重启后算不出"隔了多久"，情绪恢复/回底色全都失效
    const atNow = Number.isFinite(state.at) ? state.at : clockNow()
    return {
      schema: 1,
      mood: state.mood, at: atNow, ticks: state.ticks, scene: state.scene,
      // 长期项也要落盘：账本丢了，重启之后就变成"没记过"，那不是记仇是失忆。
      grudge: Number(state.grudge || 0), ledger: (state.ledger || []).slice(-16),
      organs: Object.fromEntries(Object.entries(organs).map(([id, m]) => [id, safeSnapshot(m)])),
    }
  }

  function restore(o) {
    if (!o || typeof o !== 'object') return
    if (Number(o.schema) !== 1) return   // X11：版本不符就冷启动
    if (typeof o.mood === 'number') state.mood = clamp(o.mood, -1, 1)
    // 冷启动 / 隔了很久才恢复：心情往底色回一半。
    // 不然几小时前那点不快会被原样带进来，一开机就是"她还在气头上"。
    if (typeof o.at === 'number') {
      const away = Math.max(0, clockNow() - o.at)
      if (away >= 30 * 60_000) {
        state.mood = clamp(state.mood + (p.moodBase - state.mood) * 0.5, p.moodBase - p.moodCap, p.moodBase + p.moodCap)
      }
      if (process.env.DSH_AFFECT_DEBUG_RESTORE) console.error('[restore]', JSON.stringify({ oAt: o.at, clock: clockNow(), away, mood: state.mood }))
    } else {
      // 老存档没有时间戳（早期版本写的 at:null）：不知道离开多久，就温和地回 1/4。
      // 不然一开机就是几小时前那股低气压，得靠聊很久才爬得回来。
      state.mood = clamp(state.mood + (p.moodBase - state.mood) * 0.25, p.moodBase - p.moodCap, p.moodBase + p.moodCap)
      if (process.env.DSH_AFFECT_DEBUG_RESTORE) console.error('[restore]', JSON.stringify({ oAt: o.at, fallback: true, mood: state.mood }))
    }
    if (typeof o.at === 'number') state.at = o.at
    // 安静期从哪一刻算起：存档时刻就是"最后一次活动"。不种这个值的话，
    // 重启后 gapMs 一直是 0，安静期的"消气"通道永远不生效（线上重启过就是这个样）。
    state.lastUserAt = Number.isFinite(Number(o.at)) ? Number(o.at) : clockNow()
    if (typeof o.ticks === 'number') state.ticks = o.ticks
    // 老存档没有这两项：按 0 处理（不是"清白"，是"没记录"）。
    if (typeof o.grudge === 'number') state.grudge = clamp(o.grudge, 0, 1)
    if (Array.isArray(o.ledger)) state.ledger = o.ledger.slice(-16)
    for (const [id, m] of Object.entries(organs)) {
      if (o.organs?.[id]) { try { m.restore(o.organs[id]) } catch { /* 单个坏不影响其他 */ } }
    }
    // 冷启动时，器官层也要松一档：光把 mood 往回拉没用，
    // amygdala.threat / insula 唤醒还是旧值的话，第一拍就把目标拉回低位。
    if (state.mood !== undefined) {
      const away = typeof o.at === 'number' ? Math.max(0, clockNow() - o.at) : null
      const k = away === null ? 0.75 : (away >= 30 * 60_000 ? 0.5 : 1)
      if (k < 1) {
        for (const id of ['amygdala', 'insula']) {
          const organ = organs[id]
          if (!organ?.snapshot || !organ?.restore) continue
          try {
            const snap = organ.snapshot()
            let touched = false
            for (const key of ['threat', 'fastThreat', 'intensity', 'arousal']) {
              if (typeof snap?.[key] === 'number') { snap[key] = snap[key] * k; touched = true }
            }
            if (touched) organ.restore(snap)
          } catch { /* 单个器官不行就算了 */ }
        }
      }
    }
    cache.clear()
    lastKnown.clear()
  }

  const ENGINE_COVER = [
    // 动力学不变量
    'K01', 'K02', 'K03', 'K04', 'K05', 'K07', 'K08', 'K09', 'K10', 'K11', 'K12',
    // 跨表一致性
    'C01', 'C02', 'C04', 'C06', 'C08', 'C07', 'C09',
    // 多器协作
    'X01', 'X02', 'X03', 'X05', 'X06', 'X07', 'X08', 'X10', 'X11', 'X12',
  ]

  const cover = () => {
    const m = Object.fromEntries(Object.entries(organs).map(([id, x]) => [id, x.cover ?? []]))
    m.engine = ENGINE_COVER
    m.inject = INJECT_COVER
    return m
  }
  const health = () => Object.fromEntries(Object.entries(organs).map(([id, m]) => [id, m.health?.() ?? { ok: true }]))

  return {
    persona: p, organs, state, trace, res,
    tick, text, snapshot, restore, read: () => fused, cover, health,
    // 人格可写的三个"感受层"旋钮就住在 p 上（threatGain / baselineMood / sensitivity）。
    // 单独开一个口子，是因为 retune 原本只能写器官 params，写不到这里。
    personaParams: () => p,
    bridgeStatus: () => (bridge?.status ? bridge.status() : null),
    debugRecall: (text) => (bridge?.debugRecall ? bridge.debugRecall(text) : null),
    setScene(scene) { state.scene = scene },
    // 关系账本（只读）：给测试/仪表页看"记了多少、还剩多少"
    grudge: () => Number(state.grudge || 0),
    ledger: () => (state.ledger || []).map((l) => ({ ...l })),
    setGap(ms) { state.gapMs = ms },
    setOther(v) { state.other = v },
    markSpoke() { world.spoke = true },
  }
}

function safeSnapshot(m) {
  try { return m.snapshot() } catch { return null }
}

const r3 = (n) => Math.round(n * 1000) / 1000

// ── 这一句是不是"冲她来的冒犯"（引擎层用，量纲：on 布尔 + mass 0..1）──────────
// 为什么不用 analyzeMessage().complaint 一把梭：
//   1) "我累死了、我想睡了"是她在说自己的状态，不是扎她——不能算冒犯；
//   2) "这个函数在 204 行"这种技术话里可能带"不/没"，只是否定，不是骂；
//   3) 真正的刺有两种：字面难听（垃圾/废物/重写），或者冲着她说（又错/说了几遍/别说了）。
const OFF_HARD = /垃圾|废物|蠢|闭嘴|滚|没用|烂|离谱|白痴|傻[逼x]?|去死|恶心|糊弄|骗我|搞砸|白干|重写/
const OFF_COLD = /^(哦|嗯|随便|都行|算了|行吧|知道了|随你)[。.!！~～\s]*$/
const OFF_DIRECTED = /说了几遍|第三次|怎么又|又错|又忘|没修好|没生效|白改|要你干嘛|做不好|行不行|别说了|不想聊|随便吧|失望|受不了|烦死|够了|你可真行|真是绝了|呵呵/
const OFF_YOU = /你|咱|跟我说|让我|给我/

// ── 这条文本是不是"人话"（冒犯判定之外形那一道门）────────────────────────
// 为什么需要它：宿主的事件流里，user/message 只是"送进模型的一条消息"，不等于"有人在说话"。
// 它带着 data.source.kind，除了 'user'（真人输入 / user-rpc）之外，还有一长串机器生成的：
//   runtime-context（每轮注入的运行时快照）、system-prompt、tool-registry、model-selection、
//   action-cards（工具栏）、schedule（定时任务）、agent-message / subagent-settled（子 agent）、
//   user-approval、compact-checkpoint、goal、webhook、team-message……
// 这些东西里天然带着"你 / 委屈 / 难过 / 被冷淡地顶了一下"这类词，offenseOf 一读就会判成冒犯。
// 所以判据分两层：结构层在 index.js（source.kind === 'user'），形状层在这里。
//
// 这里挡的是三种"不可能是冲她来的话"：
//   ① 系统/提示块：以 <system-reminder、【…】、"Current runtime context"、"### Task" 这类开头；
//   ② 工具输出：带 ``` 围栏、stdout/stderr/exit code/Traceback、import/const/function 密集的代码块；
//   ③ 超长（>600 字）：那是一段贴过来的文档或日志，不是一句说给她听的话。
// 不挡的：长短不设下限（"哦""嗯"本来就该算），带标点、带省略号、连着骂一长串——都算人话。
const SPEECH_SYS_HEAD = /^\s*(<system-reminder|<[a-z-]+>|【|Current runtime context|Current working directory|#\s)/
const SPEECH_TOOL_OUT = /(```|^\s*(stdout|stderr|exit code)\b|\bexit code:\s*\d|Traceback \(most recent|^\s*at [\w$.]+\s*\(|^\s*Total output is|\[sandbox:)/m
const SPEECH_CODE_DENSE = /\b(import \{|export const|function \w+\(|const \w+ = require\(|await \w+\(|<\?xml|<!DOCTYPE)/

export function looksLikeHumanSpeech(text) {
  const s = String(text ?? '').trim()
  if (!s) return false
  if (SPEECH_SYS_HEAD.test(s)) return false
  if (SPEECH_TOOL_OUT.test(s)) return false
  if (SPEECH_CODE_DENSE.test(s) && s.length > 200) return false
  if (s.length > 600) return false
  return true
}

export function offenseOf(text) {
  const s = String(text || '').trim()
  if (!s) return { on: false, mass: 0, hard: false, cold: false }
  const f = analyzeMessage(s)
  const hard = OFF_HARD.test(s)
  const cold = OFF_COLD.test(s)
  const directed = OFF_DIRECTED.test(s) || (f.complaint === 1 && OFF_YOU.test(s))
  const sarcasm = f.sarcasm === 1
  const on = hard || cold || (f.complaint === 1 && directed) || sarcasm
  // mass：这一句有多重。难听的话最重；冷落次之；只是"心里烦"最轻。
  const mass = clamp(
    0.55 * (hard ? 1 : 0) + 0.28 * (directed && f.complaint === 1 ? 1 : 0) +
    0.22 * (cold ? 1 : 0) + 0.20 * (sarcasm ? 1 : 0),
    0, 1,
  )
  return { on, mass: on ? Math.max(0.3, mass) : 0, hard, cold }
}
