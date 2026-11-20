// 海马体（情绪向）：只存"这件事让我什么感觉"。不存原话、不写记忆库。
// 覆盖 M01-M18。
//
// 这一版修的是"功能表里有、代码里其实跑不到"的几条：
//   · M02/M13：以前提取命中就 continue，同 cue 的事永远进不了第二次编码，
//     "同类 3 次生成规则"和"相似 0.7 另立一条"在真实对话里都不可能发生。
//     现在把提取和编码拆开：想起归想起，该另存一条还是要另存。
//   · M14：以前只有跨 3 点那一拍乘 0.8，隔 30 天只掉两成。现在按"过了几夜"算：
//     每过一夜强度 ×0.8，30 天后基本想不起来了；白天不再额外衰减（C03：隔夜/再巩固分时段）。
//   · M12/M17/M18：以前 persons 只有计数、nostalgia 靠 recalls>1、distortion 恒 0。
//     现在分别有雷区、怀旧线索、细节漂移。

import { clamp, hash, dayKey } from '../core/consts.js'

const P = {
  // M03 语义召回：只有一条很短的线索（"哦"）也要能把整件事捞回来，别拿字面重合度卡死。
  writeThreshold: 0.25,     // M01 情景编码：salience > 0.25 才写
  maxEpisodes: 400,
  separation: 0.85,         // M02 模式分离：相似度超过这条线才算"同一件事"
  reconsolidationMax: 5,    // M07/C03 再巩固最多改写 5 次
  overnight: 0.8,           // M06 夜间巩固 / M16 睡眠再加工：每过一夜强度 -20%
  nightFrom: 3,             // 巩固窗口：凌晨 3 点到中午，一天只做一次
  nightTo: 12,
  dropIntensity: 0.01,      // M14 淘汰线（低强度、也不再唤起）
  dropSalience: 0.15,
  recallBase: 0.5,          // M08 提取门
  weakRecallCut: 0.2,       // T03 低 5-HT（冲动）时检索门放松的幅度
  neThresholdCut: 0.06,     // T01 高 NE 时写入门槛下调的幅度
}

const BRIEF = {
  否定: '被否定了一下', 命令: '被催了一句', 冷: '被冷淡地顶了一下',
  热: '被夸了一下', '': '说了几句话',
}

// M18 记忆失真：细节记岔是常事（场景漂到相邻的），但情绪方向不该跟着翻
const DRIFT = { home: 'office', office: 'home', work: 'home', night: 'home' }

// M12 社会记忆：对方的雷区只从这几类话题里认，不做自由抽取
const TOPICS = ['妈', '爸', '前任', '工资', '胖', '年龄', '工作', '加班', '成绩', '朋友', '家里']
const MINE_HINT = /别提|别说|不要提|不想聊|不许说|别问|别再提/

// M17 怀旧：听歌、翻照片这类线索
const NOSTALGIA = /(听|放|刷|单曲).{0,8}(歌|老歌|那首|这首|音乐)|(翻|看|找).{0,6}照片|以前的照片|那时候|那年/

export function create(cfg = {}) {
  const p = { ...P, ...cfg }
  const fresh = () => ({
    episodes: [], pending: [], schemas: [], persons: {}, lastRecall: null, lastLandmine: null,
    encodes: 0, skipped: 0, overnightAt: 0, reactivate: 0, nostalgia: 0, frame: 0,
  })
  let s = fresh()

  /** 同一帧回填：编码这一步还拿不到"这一刻"的情绪（fuse 在后面才跑），
   *  等它出来再盖章，否则写回账本的 kind 永远是上一句的、或者空的。 */
  const stampLast = ({ kind } = {}) => {
    const e = s.episodes[s.episodes.length - 1]
    if (!e) return null
    if (!e.kind && kind) e.kind = String(kind)
    return e
  }

  const classify = (text) => {
    const t = String(text || '')
    if (/[滚闭嘴烦讨厌]|随便|都行|哦$|嗯$/.test(t)) return '冷'
    if (/^(快|赶紧|别|给我)/.test(t)) return '命令'
    if (/[不没别]/.test(t)) return '否定'
    if (/[哈嘿夸好乖爱谢]/.test(t)) return '热'
    return ''
  }

  /** 相似度：cue 占七成（同一类刺激），情绪方向差多少占三成。
   *  同 cue、感觉相反 → 正好 0.7（M02 验收里那个"相似 0.7"）。
   *  冷/否定/命令同属"被顶一下"这一类：cue 不完全一样，也算七五成的像。 */
  const cueNear = (a, b) => {
    if (a === b) return 1
    const fam = (x) => (x === '冷' || x === '否定' || x === '命令' ? 'neg' : x === '热' ? 'pos' : x)
    return fam(a) === fam(b) ? 0.75 : 0
  }
  const sim = (e, q) => clamp(
    0.7 * cueNear(e.cue, q.cue) +
    0.3 * (1 - Math.min(1, Math.abs(Number(e.valence || 0) - Number(q.valence || 0)))),
    0, 1,
  )

  // 一条情景现在有多"实"：用唤起度（salience），不是当时的强度——
  // 强度会被隔夜巩固压下去，但"这事还提得起来"靠的是它有多显眼。
  const strengthOf = (e) => clamp(Number(e.salience || 0), 0, 1)

  /** 这段时间里跨过几次凌晨三点（M06/M16 的"过夜"按真实次数算，不按拍数） */
  const nightsBetween = (t0, t1) => {
    if (!(t1 > t0)) return 0
    const d = new Date(t0)
    d.setHours(3, 0, 0, 0)
    let b = d.getTime()
    if (b <= t0) { d.setDate(d.getDate() + 1); b = d.getTime() }
    let n = 0
    while (b <= t1 && n < 400) { n += 1; d.setDate(d.getDate() + 1); b = d.getTime() }
    return n
  }

  return {
    id: 'hippocampus',
    cover: ['M01', 'M02', 'M03', 'M04', 'M05', 'M06', 'M07', 'M08', 'M09', 'M10', 'M11', 'M12', 'M13', 'M14', 'M15', 'M16', 'M17', 'M18', 'W03', 'C03'],
    /** X08：情景延迟落库——等这一帧的归因出来再提交 */
    commit() {
      if (!s.pending.length) return
      s.episodes.push(...s.pending)
      s.pending = []
      if (s.episodes.length > p.maxEpisodes) s.episodes = s.episodes.slice(-p.maxEpisodes)
    },
    stampLast,
    params: p,

    step(w) {
      const amy = w.get('amygdala')
      if (!amy) return
      const ins = w.get('insula')
      const nm = w.get('neuromod') ?? {}
      const mood = w.mood ?? 0
      const t1 = Number(w.tx?.t1 ?? Date.now())
      s.lastRecall = null
      s.lastLandmine = null
      // M15 那一笔"刚想起的旧事很烫"按分钟退：0.9^分钟（60 秒一拍与旧行为完全一致），
      // 不能写成每拍 ×0.9 —— 2 秒一拍时它 6 秒就没了，60 秒一拍时要 10 分钟。
      const _dtMin = clamp(Number(w.tx?.dtMs ?? 0), 0, 60 * 86400_000) / 60_000
      s.reactivate = Math.max(0, s.reactivate * Math.pow(0.9, Math.min(60, _dtMin)))
      s.nostalgia = 0

      const stress = clamp(Number(w.get('hypothalamus')?.hpa?.cortisol ?? 0), 0, 1)
      const salience = clamp(Number(amy.salience ?? 0), 0, 1)
      const want = clamp((amy.rewardPE ?? 0) - 0.7 * amy.threat, -1, 1)
      const scene = w.scene || 'home'
      const ach = clamp(Number(nm.ach ?? 0.4), 0, 1)                 // T04
      const ne = clamp(Number(nm.ne ?? 0.3), 0, 1)                   // T01
      const oxytocin = clamp(Number(nm.oxytocin ?? 0.35), 0, 1)      // T05
      const trustThreshold = clamp(Number(nm.trustThreshold ?? 0.62), 0.2, 0.8)
      const impulsivity = clamp(Number(nm.impulsivity ?? 0.25), 0, 1) // T03
      const events = Array.isArray(w.tx?.events) ? w.tx.events : []

      // ── M06 夜间巩固 / M16 睡眠再加工 / W03 隔夜再加工 / M14 遗忘 ──
      // 一段真实时间跨过几夜就降几次；同一夜只做一次。C03：隔夜只在夜里做，
      // 再巩固只在白天提取时做，两件事不叠在同一拍上。
      const dt = clamp(Number(w.tx?.dtMs ?? 0), 0, 60 * 86400_000)
      const hour = new Date(t1).getHours()
      const inWindow = hour >= p.nightFrom && hour < p.nightTo
      const today = dayKey(t1)
      let nights = nightsBetween(t1 - dt, t1)
      if (inWindow && s.overnightAt !== today) nights = Math.max(1, nights)
      if (nights > 0) {
        s.overnightAt = today
        const hard = Math.pow(p.overnight, nights)        // M06/M16 每夜 -20%
        const soft = Math.pow(0.95, nights)
        for (const e of s.episodes) {
          e.intensity = clamp(Number(e.intensity || 0) * hard, 0, 1)
          e.salience = clamp(Number(e.salience || 0) * soft, 0, 1)
          e.nights = (e.nights || 0) + nights
        }
        // M14 淘汰：强度没了、也再唤不起来的那类，清掉
        s.episodes = s.episodes.filter(e => e.intensity > p.dropIntensity || e.salience > p.dropSalience)
      }

      // M01 编码门；T01 高 NE 时门槛下调；T04 ACh 管的是"记得多深"，不是门
      const gate = clamp(p.writeThreshold - p.neThresholdCut * Math.max(0, (ne - 0.3) / 0.7), 0.12, 0.25)
      // T03 低 5-HT：检索门也松一档（冲动，不那么审慎）
      const recallGate = p.recallBase - p.weakRecallCut * impulsivity

      for (const ev of events) {
        if (ev.type !== 'user') continue
        const text = String(ev.text || '')
        const cue = classify(text)

        // ── M12 社会记忆：先看踩没踩到已有的雷区，再记新的 ──
        const person = (s.persons['他'] = s.persons['他'] || { likes: 0, hurts: 0, landmines: [] })
        if (!Array.isArray(person.landmines)) person.landmines = []
        const topics = TOPICS.filter(t => text.includes(t))
        const hitMine = topics.find(t => person.landmines.includes(t)) ?? null
        if (hitMine) s.lastLandmine = hitMine
        const hurts = cue === '冷' || cue === '否定' || /滚|闭嘴|烦|讨厌/.test(text)
        if (MINE_HINT.test(text) || (hurts && topics.length)) {
          for (const t of topics) if (!person.landmines.includes(t)) person.landmines.push(t)
        }

        // ── M08 提取：相似 × 情绪一致性 × 新旧 × 强度；T03 冲动放松检索门 ──
        const scored = s.episodes.map(e => {
          const ageDays = Math.max(0, (t1 - Number(e.at || 0)) / 86400_000)
          const base =
            0.45 * sim(e, { cue, valence: want }) +
            0.25 * (1 - Math.abs(Number(e.valence || 0) - Number(mood || 0)) / 2) +
            0.15 * Math.exp(-ageDays / 7) +
            0.15 * clamp(Number(e.salience || 0), 0, 1)
          return { e, score: base * (0.5 + 0.5 * strengthOf(e)) }
        }).sort((a, b) => b.score - a.score)

        let hits = scored.filter(c => c.score > recallGate)
        // M09 应激抑制提取：皮质醇高时只回一条，想不起更多
        if (stress > 0.6) hits = hits.slice(0, 1)

        if (hits.length) {
          const h = hits[0]
          const before = Number(h.e.valence) || 0
          h.e.recalls = (h.e.recalls || 0) + 1
          // M07 再巩固：提取一次改一次，最多 5 次；改完要留痕
          if ((h.e.reconsolidations || 0) < p.reconsolidationMax) {
            h.e.valence = clamp(Number(h.e.valence || 0) * 0.85 + want * 0.15, -1, 1)
            h.e.reconsolidations = (h.e.reconsolidations || 0) + 1
            h.e.reconsolidatedAt = t1
          }
          // M18 记忆失真：细节漂移，方向不变
          h.e.distortion = (h.e.distortion || 0) + 1
          if (h.e.distortion >= 3 && !h.e.sceneClaimed) {
            h.e.sceneClaimed = DRIFT[h.e.scene] ?? h.e.scene
          }
          if (h.e.sceneClaimed) {
            const sgn = Math.sign(before) || Math.sign(Number(h.e.valence) || 0)
            h.e.valence = clamp(sgn * Math.max(0.1, Math.abs(Number(h.e.valence) || 0.1)), -1, 1)
          }
          const ageDays = Math.round((t1 - Number(h.e.at || 0)) / 86400_000)
          s.lastRecall = {
            hit: true,
            brief: h.e.triggerBrief,
            kind: h.e.kind ?? null,
            valence: h.e.valence,
            intensity: h.e.intensity,
            at: h.e.at,
            ageDays,                                        // M04 时间是"上周"还是"刚才"
            scene: h.e.sceneClaimed ?? h.e.scene,           // M05 场景标签（失真后是记岔的那个）
            hits: hits.length,                              // M09/M08 这一问想起来几条
          }
          // M15 情境恐惧：同一个场景里想起负性的事，恐惧回升更多
          const sceneMatch = (h.e.sceneClaimed ?? h.e.scene) === scene
          s.reactivate = clamp(0.2 + (sceneMatch ? 0.15 : 0) + (h.e.valence < 0 ? 0.1 : 0), 0, 0.6)
        }

        // ── M01 编码门：没到门槛就不写（但上面的"想起"照常发生）──
        if (salience < gate) { s.skipped += 1; continue }
        // ── M02 模式分离：只有足够像才合并；0.7 那样"同 cue 反感觉"必须另立一条 ──
        let near = null
        for (const e of s.episodes) {
          const v = sim(e, { cue, valence: want })
          if (!near || v > near.v) near = { e, v }
        }
        const boost = stress > 0.5 ? 1.5 : 1              // M10 应激增强编码
        if (near && near.v > p.separation) {
          // 已经是一条事：只刷新"最近一次"和重复次数。
          // 不动 intensity——那是隔夜巩固管的量，提取/重复不该把它改掉（C03）。
          near.e.at = t1
          near.e.repeats = (near.e.repeats || 0) + 1
        } else {
          const deep = ach >= 0.6                                    // T04 高 ACh 编码更深
          const intimate = cue === '热' && oxytocin >= trustThreshold // T05 亲密后记得更"近"
          s.pending.push({
            id: `ep_${s.encodes}_${hash(cue + want.toFixed(2) + t1)}`,
            at: t1, day: dayKey(t1), cue,
            triggerBrief: BRIEF[cue] ?? BRIEF[''],
            kind: w.emotions?.[0]?.kind ?? null,
            target: w.emotions?.[0]?.target ?? null,
            valence: want,
            intensity: clamp((ins?.felt?.intensity ?? salience) * (deep ? 1.15 : 1) * (intimate ? 1.1 : 1), 0, 1),
            salience: clamp(salience * boost * (deep ? 1.2 : 1), 0, 1),
            scene,
            strength: 1,
            depth: deep ? 'deep' : 'normal',
            intimate,
            recalls: 0, reconsolidations: 0,
            distortion: 0,
          })
          s.encodes += 1
        }

        if (want > 0.2) person.likes += 1
        if (want < -0.2) person.hurts += 1
      }

      // ── M13 图式：同一类事第 3 次之后生出规则 ──
      const byCue = {}
      for (const e of s.episodes) byCue[e.cue] = (byCue[e.cue] || 0) + 1
      for (const [cue, n] of Object.entries(byCue)) {
        if (n >= 3 && !s.schemas.find(x => x.cue === cue)) {
          s.schemas.push({
            cue,
            rule: cue === '冷' ? '他一冷下来就是不想理我' : `对${cue}的反应`,
            confidence: clamp(0.6 + 0.1 * n, 0, 0.95),
            since: t1,
          })
        }
      }

      // ── M11 未来模拟：焦虑 + 带宽不够时，脑子里长出"还没发生"的事 ──
      const bandwidth = clamp(Number(w.get('pfc')?.bandwidth ?? 0.6), 0, 1)
      if ((amy.threat ?? 0) > 0.5 && bandwidth < 0.5) {
        s.lastRecall = { ...(s.lastRecall || { hit: false }), worry: '会不会一直这样' }
      }

      // ── M17 怀旧：听歌 / 翻照片，碰上一条够老的正面记忆 ──
      const nostalgiaCue = events.some(e => e.type === 'user' && NOSTALGIA.test(String(e.text || '')))
      if (nostalgiaCue) {
        const old = s.episodes.filter(e => Number(e.valence) > 0.2 && (t1 - Number(e.at || 0)) > 7 * 86400_000)
        if (old.length) s.nostalgia = clamp(0.4 + 0.1 * Math.min(2, old.length), 0, 0.6)
      }

      s.frame += 1
    },

    read() {
      return {
        frame: s.frame,
        recall: s.lastRecall,
        landmine: s.lastLandmine,        // M12 这一句踩到了对方的哪个雷区
        count: s.episodes.length + s.pending.length,
        encodes: s.encodes,
        schemas: s.schemas.slice(-3),
        persons: { ...s.persons },
        nostalgia: s.nostalgia,          // M17
        reactivate: s.reactivate,        // M15 给杏仁核
        recent: s.episodes.slice(-3).map(e => ({
          brief: e.triggerBrief, valence: e.valence, intensity: e.intensity,
          at: e.at, scene: e.sceneClaimed ?? e.scene,
        })),
      }
    },
    snapshot: () => ({ ...s, episodes: s.episodes.map(e => ({ ...e })), pending: s.pending.map(e => ({ ...e })), schemas: s.schemas.map(x => ({ ...x })) }),
    restore(o) { if (o) s = { ...fresh(), ...o, episodes: (o.episodes || []).map(e => ({ ...e })), pending: (o.pending || []).map(e => ({ ...e })) } },
    health: () => ({ ok: true, degraded: false, frame: s.frame }),
  }
}
