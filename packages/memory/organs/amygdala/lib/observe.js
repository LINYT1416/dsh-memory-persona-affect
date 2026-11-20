// 单一入口：所有事件从这里进。
// 对应功能总表：A0-1 ~ A0-6、A8-3 批量、E1。
//
// 写路径只 push 不 await（P1）：调用方 fire-and-forget 即可。

import { appendJsonl, FILES } from './store.js'
import { entitiesOf, atOf } from './score.js'
import { parseSelf, parseOther } from './emotion.js'
import { relationOf, intimacyOf, threatOf } from './social.js'
import { vividnessOf, split } from './fidelity.js'

// 一次负性配对（4.3"一次配对就够"）
// 除情绪词，也要收"被占便宜"的常见说法：收钱跑路、失联、赖账、甩锅——
// 以前只认 气死/恶心/被坑，于是「中介收了定金就失联」学不到怕（cue 拿到了但没配对）。
const NEG_EVENT_RE = /讨厌|受够|别再|别跟我提|烦死|难受|我怕|害怕|不想提|气死|恶心|被坑|受伤|委屈|恨他|恨她|跑路|失联|骗钱|骗走|赖账|甩锅|坑了/
// 恐惧的 cue 不能是"那个/这个/他"这类指代词：抽到它们，等于把恐惧记在一个
// 以后没人会再提到的词上——功能通了，记的东西没用。选 cue 时先跳过这些。
const CUE_STOPWORDS = new Set([
  '那个', '这个', '那些', '这些', '他们', '她们', '我们', '你们', '一个', '这个事',
  '他', '她', '它', '我', '你', '人', '事', '东西', '时候', '现在', '今天', '刚才',
])
function pickCue(entities, text) {
  const body = String(text || '')
  // 首选：「那个/这个/一个」后面的名词就是用户心里的那个东西
  const m = body.match(/(?:\u90a3\u4e2a|\u8fd9\u4e2a|\u4e00\u4e2a|\u90a3\u4f4d|\u8fd9\u4f4d)([\u4e00-\u9fa5A-Za-z0-9]{2,3})/)
  if (m) {
    let w = m[1]
    // 「中介骗」这种把动词尾巴切掉。
    // 补：收/拿/欠/跑/赖/坑/甩/扣/拖/占 这些动词以前会被留在 cue 里，
    // 于是「中介收钱跑路」抽到的 cue 是「中介收」——以后没人会说这个词，caution('中介') 永远 null。
    while (w.length > 2 && /(骗|说|做|让|把|给|是|真|太|很|又|就|还|收|拿|要|欠|跑|失|赖|坑|甩|扣|拖|占)$/.test(w)) w = w.slice(0, -1)
    if (w.length >= 2 && !CUE_STOPWORDS.has(w)) return w
  }
  const list = Array.isArray(entities) ? entities : []
  const cands = []
  for (const e of list) {
    // 剥掉指代前缀：「那个中介」→「中介」
    let w = String(e || '').trim().replace(/^(那个|这个|那些|这些|一个|一位)/, '')
    if (!w || CUE_STOPWORDS.has(w)) continue
    if (w.length < 2 || w.length > 6) continue
    // 整句/情绪片段不是 cue：「我气死了」「真想去报警」这类要挡掉
    if (/^(我|你|他|她|它)/.test(w)) continue
    if (/(气死|讨厌|难受|害怕|烦死|委屈|被骗|报警|想去)/.test(w)) continue
    cands.push({ w, at: body.indexOf(String(e || '')) })
  }
  // 长的更可能是实体；一样长时取文本里靠后的那个
  // （「那个中介」会切出「个中」「中介」，靠后的是「中介」）
  cands.sort((a, b) => (b.w.length - a.w.length) || (b.at - a.at))
  if (cands.length) return cands[0].w
  return body.slice(0, 12)
}
// 承诺/约定
const COMMIT_RE = /答应|约好|说好|一定|务必|记住/

/** 从文本猜说话人（没有就 unknown）。 */
export function speakerOf(text, fallback = 'unknown') {
  const s = String(text || '')
  const m = s.match(/^(我|俺|咱)/)
  if (m) return 'self'
  return fallback
}

/** 情境：session / place / scene。缺就是 L0。 */
export function contextOf(event = {}) {
  const session = String(event.session || event.sessionId || 'unknown')
  const place = String(event.place || event.scene || '')
  return {
    session,
    place,
    scene: place,
    hasSession: session !== 'unknown',
    hasPlace: Boolean(place),
    level: place ? 2 : session !== 'unknown' ? 1 : 0,
  }
}

export function makeObserver(deps = {}) {
  const {
    state, switches, audit, scorer, tone, capture, fear, gate, fidelity, review, ports,
  } = deps
  if (!state || !scorer) throw new Error('observer needs state + scorer')

  /** 单条事件。返回可读结果。 */
  async function observe(event = {}) {
    const kind = String(event.kind || 'utterance')
    const at = atOf(event.at)

    // ── 非打分事件：直接转给对应器官 ────────────────────────
    if (kind === 'correction') return handleCorrection(event, at)
    if (kind === 'verdict') {
      state.lastVerdict = { at, ...event }
      return { v: 1, handled: 'verdict', at }
    }
    if (kind === 'mood') {
      state.lastMood = { at, valence: Number(event.valence || 0), arousal: Number(event.arousal || 0) }
      return { v: 1, handled: 'mood', at }
    }

    // ── 打分路径 ────────────────────────────────────────────
    if (switches && !switches.active('score', 'bla')) {
      return { v: 1, skipped: 'bla-off', at }
    }

    const text = String(event.text || '')
    if (!text.trim()) return { v: 1, skipped: 'empty', at }

    const ctxInfo = contextOf(event)
    const speaker = String(event.speaker || speakerOf(text))
    const channel = String(event.channel || event.source?.channel || 'dsh')
    const source = {
      channel,
      speaker,
      // MeA 关掉 → 关系不参与（A7-5）
      relation: event.relation || (switches?.nucleusIsOff?.('mea') ? 'unknown' : relationOf(text).relation),
      intimacy: switches?.nucleusIsOff?.('mea')
        ? 0
        : (event.intimacy ?? intimacyOf(Number(event.speakerCount || 0))),
      isOwner: Boolean(event.isOwner),
    }

    const ctx = {
      at,
      id: event.id || event.episodeId || null,
      text,
      session: ctxInfo.session,
      place: ctxInfo.place,
      scene: ctxInfo.scene,
      goals: event.goals || [],
      others: event.others || [],
      preVerdict: event.preVerdict || null,
      source,
      fine: event.fine || null,
      arousal: event.arousal,
      polarity: event.polarity,
      entities: event.entities,
    }

    const result = scorer.score(ctx)
    result.entities = entitiesOf(text)

    // 复述 / 冲突（A5-4、A5-5）—— 受功能开关控制（A7-4）
    const fidelityOn = switches?.isOff?.('fidelity') !== true
    const subject = (result.entities[0] || 'unknown')
    const rev = fidelityOn ? fidelity?.revision?.(subject, event.textHash || hashOf(text), { at }) : null
    const conf = fidelityOn
      ? fidelity?.conflict?.(subject, text.slice(0, 40), { at, polarity: result.polarity })
      : null

    if (conf?.kind === 'conflict') {
      state.counters.conflict = (state.counters.conflict || 0) + 1
      result.tags.push('conflict')
      await safeWrite(FILES.conflicts, conf.item)
      audit?.log('conflict', { subject, id: ctx.id })
    }

    // 调质注入（A2-1）：事件 → NE，CeA → cort
    // 注意：cea 关掉时不注入皮质醇，但 NE 照常（R14），所以这里只判 tone 功能
    if (switches?.isOff?.('tone') !== true) {
      tone?.inject?.(
        { arousal: result.arousal, polarity: result.polarity, extreme: result.tags.includes('extreme') },
        switches,
        at,
      )
    }

    // 打标 / 捕获（A2-3、A2-4）
    if (capture && switches?.active('capture', 'bla') !== false) {
      if (result.score >= 0.8 || result.tags.includes('extreme')) {
        capture.tag({ id: ctx.id, at, entities: result.entities, session: ctxInfo.session, strength: result.score })
      } else {
        capture.capture({ id: ctx.id, at, entities: result.entities, session: ctxInfo.session })
      }
    }

    // 恐惧：一次负性配对（A3-1）
    // 学和查必须用同一个键：以前学习用 pickCue、查却用 entities[0]，
    // 存的是"中介"、查的是"那个"，于是永远查不到（caution 恒 null）。
    let caution = null
    let fearSubject = ''
    if (fear && switches?.active('fear', 'bla') !== false && NEG_EVENT_RE.test(text) && result.polarity < 0) {
      const subj = pickCue(result.entities, text)
      fearSubject = subj
      const learned = fear.learnCue(subj, { at, strength: 0.6 + Math.abs(result.polarity) * 0.3, byId: ctx.id })
      // 落盘：以前只写进内存 Map，重启就全忘了——index.js 明明有读回逻辑，
      // 但从来没人写这个文件（"学到的怕"活不过一次重启）。
      if (learned?.key) void appendJsonl(FILES.aversion, learned)
      // 情境恐惧（A3-2）：跟 cue 型分开存，key 是 session/place
      if (ctxInfo.hasSession || ctxInfo.hasPlace) {
        const ctxRow = fear.learnContext({
          session: ctxInfo.session,
          place: ctxInfo.place,
          at,
          strength: 0.6,
          byId: ctx.id,
        })
        if (ctxRow?.key) void appendJsonl(FILES.aversion, ctxRow)
      }
      // reinstatement：同类再提，压制失效（A3-6 第三种）
      gate?.reinstatement?.(`cue:${String(subj).toLowerCase()}`, { at })
      audit?.log('aversion', { subject: subj, id: ctx.id, context: ctxInfo.hasPlace ? ctxInfo.place : null })
    }

    // 门控·表达（A3-5）：ITC 关掉就不压（A7-5）
    if (fear) {
      const subjectForKey = fearSubject || result.entities[0] || ''
      if (subjectForKey) {
        const itcOn = switches?.nucleusIsOff?.('itc') !== true
        const g = itcOn
          ? gate?.gateExpression?.(`cue:${String(subjectForKey).toLowerCase()}`, {
            now: at,
            session: ctxInfo.hasSession ? ctxInfo.session : null,
          })
          : 1
        caution = fear.cautionOf(subjectForKey, { now: at, gateFactor: g ?? 1 })
        if (caution) result.tags.push('caution')
      }
    }

    // 极端 → 复核（A5-6）—— 受功能开关控制
    if (result.tags.includes('extreme') && review && switches?.isOff?.('review') !== true) {
      review.enqueue({
        id: ctx.id,
        subject,
        reason: 'extreme-arousal',
        delta: -0.05,
        score: result.score,
        at,
      })
      state.counters.review = (state.counters.review || 0) + 1
    }

    // 失真两数（A5-1、A5-2、R7）
    // 新写入的条目 ageDays=0，漂移是查旧条目时才起作用（见 provider.fidelitySplit）
    const vivid = vividnessOf(result.arousal, result.tags.includes('extreme'))
    const fidelityTwo = split(result.trust, vivid, Number(event.ageDays || 0))
    result.vividness = Number(fidelityTwo.vividness)
    result.confidence = Number(fidelityTwo.confidence)
    result.certainty = Number(fidelityTwo.certainty)

    // 记账
    scorer.remember(result, ctx)
    audit?.log('score', {
      id: ctx.id,
      score: result.score,
      raw: result.raw,
      depth: result.modulators?.depth,
      tags: result.tags,
      degraded: result.degraded,
    })

    // 落盘（fire-and-forget，不阻塞调用方）
    void safeWrite(FILES.scores, {
      v: 1,
      at,
      id: ctx.id,
      session: ctxInfo.session,
      textHash: event.textHash || hashOf(text),
      score: result.score,
      raw: result.raw,
      rank: result.rank,
      depth: result.modulators?.depth,
      tags: result.tags,
      polarity: result.polarity,
      arousal: result.arousal,
      degraded: result.degraded,
      source: result.source,
      components: result.components,
    })

    return {
      v: 1,
      at,
      id: ctx.id,
      score: result.score,
      rank: result.rank,
      modulators: result.modulators,
      tags: result.tags,
      reasons: result.reasons,
      components: result.components,
      polarity: result.polarity,
      arousal: result.arousal,
      vividness: result.vividness,
      confidence: result.confidence,
      caution,
      other: result.other,
      threat: result.threat,
      revision: rev,
      conflict: conf?.kind || 'none',
      degraded: result.degraded,
      source: result.source,
    }
  }

  /** 批量：海马将来可能一次写 50 条（A8-3）。 */
  async function observeMany(events = []) {
    const out = []
    for (const ev of events) out.push(await observe(ev))
    return out
  }

  async function handleCorrection(event, at) {
    const targetId = String(event.targetId || event.id || '')
    if (!targetId) return { v: 1, skipped: 'no-target', at }
    gate?.addCorrection?.({
      targetId,
      byId: event.byId || null,
      kind: event.kind || 'retract',
      weight: Number(event.weight || 0.35),
      subject: event.subject || null,
      at,
    })
    audit?.log('correction', { targetId, weight: event.weight, kind: event.kind })
    await safeWrite(FILES.corrections, {
      v: 1, at, targetId, byId: event.byId || null, kind: event.kind || 'retract', weight: Number(event.weight || 0.35),
    })
    return { v: 1, handled: 'correction', targetId, at }
  }

  return { observe, observeMany, contextOf, speakerOf }
}

function hashOf(text) {
  let h = 2166136261
  const s = String(text || '')
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return (h >>> 0).toString(36)
}

async function safeWrite(file, row) {
  try {
    await appendJsonl(file, row)
  } catch { /* 落盘失败不影响判断 */ }
}
