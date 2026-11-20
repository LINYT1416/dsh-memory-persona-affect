// 杏仁核：A 段快评（先反应）+ B 段衰减/消退/泛化（后解释）。
// 覆盖 A01-A21。不产生感受、不做标签、不存原话。
//
// 这一版补齐的是"验收里写了、代码里其实没有"的那几条：
//   · A06/A09 情境恐惧：context[] 以前一直累加、从来没人读，深夜并没有比白天更紧；
//   · A07/A08 消退与自发恢复：safety[] 只在被骂时涨、threat 完全不看它，
//     而且按"小时"衰减（0.97^336 ≈ 0），两周后不是"掉到 0.65"而是掉到零；
//   · A10 应激复现：只在同一帧里 +0.05*safety，看不出"旧伤自己回来了"；
//   · A11 泛化：generalized[] 写了，但没有任何一条通路把它变成 threat；
//   · A12 敏化：只有线索级的 sens，没有"反复受挫之后阈值整体下移"；
//   · A13 习惯化：sens 只会在"别的线索"出现时衰减，同一条线索重复 20 次反而涨到上限；
//   · A17 注意捕获：read() 里拿 Date.now() 跟注入时钟比，测试/补算里永远是 0；
//   · A18 情绪增强记忆：salience 给了海马体，但没有"留多久"这件事。
// 每一条都改成"有输入 → 有通路 → 有观测字段"，注释里写清楚是哪条。

import { clamp, decay, pragmatics, sat } from '../core/consts.js'

const P = {
  // tauThreat：一次刺激的即时威胁退到 1/e 的时间（分钟）。
  //   8 分钟是这条链上所有东西（句长、延迟、窄化、应激累积）共同的标尺：
  //   1.0 → 0.25 要 11 分钟，所以"安静期的消气"没有再压这里，
  //   而是在引擎里另开了一条"超过 3 分钟没人说话才生效"的通道（见 engine.js 的 tauQuietMin）。
  tauThreat: 8, tauNe: 25, tauCort: 70,
  sensGain: 0.15, sensMax: 1.6,
  threatStepCap: 0.35,
  generalizePower: 2,
  contextGain: 0.1,

  // ── 这一版补上的旋钮：每个都对着一条验收 ────────────────
  sensThreshold: 0.2,    // A05 够得上"被扎"的输入门槛
  sensCeil: 0.7,        // A13 威胁已经顶到这里，再重复也学不到新东西 → 钝化
  habitRate: 0.97,       // A13 每次"没有升级"的重复，敏化系数打这个折
  generalizeDrive: 0.25, // A11 泛化：怕过的线索，同类的新线索也会紧一下
  contextLearn: 0.35,    // A06 情境恐惧的学习速度
  contextFloor: 0.2,     // A06 怕过的场景给 0.2 的底（"深夜同样一句话更容易被听成刺"）
  contextTauDays: 14,    // A06/A08 情境恐惧按天淡
  extinctionGain: 0.95,  // A07 消退：pfcGain=1 压掉 85%，pfcGain=0.2 只压 17%
  safetyLearn: 0.2,      // A07 每次安全经历学到多少
  safetyTauDays: 14,     // A08 两周不碰 → safety 掉到 0.65 左右
  reinstatement: 0.3,    // A10 皮质醇高时，旧恐惧按安全记忆的强度自己回来
  frustrateGain: 0.15,   // A12 一次"真被扎到"让触发阈值往下掉多少
  tauFrustration: 30,    // A12 那股劲多久回弹（分钟）
  frustrateFloor: 0.5,   // A12 阈值最低压到 0.5
  deepSalience: 0.6,     // A18 深编码门槛
  deepKeepDays: 200,     // A18 高显著事件的保留期
  deepKeepMax: 64,
  captureThreat: 0.6,    // A17 高唤醒门槛
  captureMs: 5000,       // A17 注意捕获窗口
}

export function create(cfg = {}) {
  const p = { ...P, ...cfg }
  const fresh = () => ({
    threat: 0.05, fastThreat: 0, rewardPE: 0, novelty: 0, salience: 0.1,
    ne: 0.1, cort: 0.1, freeze: 0, captureUntil: 0,
    echoAt: null,
    sens: {}, safety: {}, exposures: {}, context: {}, generalized: {},
    lastKind: 'neutral', cue: '', lastCue: '', lastLen: 0, lastScene: '',
    frustration: 0, stressEpisode: false, deepTags: [], hotThreat: false,
    frame: 0, stale: false, now: 0,
  })
  let s = fresh()

  const cueOf = (f) => (f.cold ? '冷' : f.imperative ? '命令' : f.negation ? '否定' : f.warm ? '热' : '')
  const maxOf = (o) => Object.values(o || {}).reduce((m, v) => Math.max(m, Number(v) || 0), 0)

  // A03/A18 显著性：威胁 + 奖赏 + 新异 + 余韵，饱和。
  // 这个数就是给海马体的编码门控——高 salience 的事件才配"记得牢"。
  const salienceOf = () => clamp(sat(
    1.2 * s.threat + 0.8 * Math.abs(s.rewardPE) + 0.5 * s.novelty +
    0.3 * (s.ne + s.cort) / 2 + 0.3 * (s.memSalience ?? 0),
  ), 0, 1)

  return {
    id: 'amygdala',
    cover: ['A01', 'A02', 'A03', 'A04', 'A05', 'A06', 'A07', 'A08', 'A09', 'A10', 'A11', 'A12', 'A13', 'A14', 'A15', 'A16', 'A17', 'A18', 'A19', 'A20', 'A21', 'K06', 'X04'],
    params: p,

    /** A 段：只做快评，不衰减（先反应） */
    fast(w) {
      const t1 = Number(w?.tx?.t1 ?? 0)
      const dt = Number(w?.tx?.dtMs ?? 0)
      // X04：这一帧能用的是上一帧的 pfcGain（同帧读会成环）
      const gain = clamp(Number(w?.prevGain ?? 0.5), 0, 1)
      const events = Array.isArray(w?.tx?.events) ? w.tx.events : []
      let threatIn = 0, warm = 0, novelty = 0, cue = ''
      for (const ev of events) {
        if (ev.type !== 'user' && ev.type !== 'assistant') continue
        const f = pragmatics(ev.text)
        if (f.apology) {
          // A07 消退：道歉 = 一次"这条线索原来没有危险"的经历。
          // 压多少由 vmPFC 的增益决定——睡不够、带宽低的时候，道歉压不下去。
          const key = s.lastCue || '平静'
          s.safety[key] = clamp((s.safety[key] ?? 0) + p.safetyLearn * (1 - (s.safety[key] ?? 0)) * gain, 0, 1)
          s.threat = clamp(s.threat * (1 - p.extinctionGain * gain), 0.02, 1)
          for (const k of Object.keys(s.sens)) s.sens[k] = Math.max(1, s.sens[k] * 0.9)
          s.lastKind = 'apology'
          continue
        }
        // A01 低路：语用特征，几十毫秒。
        // 只对**对方说的话**成立：她自己的回复是"我在说什么"，不是"有人冲我来了"。
        // 以前 assistant 事件走同一条低路，于是她每说一句带"不/没/别"的普通话
        // （cue=否定，sens≈1.55，ne=1 时增益 1.6）都会把 threat 重新顶回 1 ——
        // 线上 threat 钉在 1、安静期只掉 0.1，一大半是这台"自己扎自己"的水泵。
        // 她说重话伤到自己那条路保留在 A21（单独的、明确的模式表）。
        if (ev.type === 'user') {
          threatIn = Math.max(threatIn, clamp(
            0.35 * f.cold + 0.15 * (f.negation > 0 ? 1 : 0) + 0.40 * f.imperative +
            0.12 * Math.min(1, f.secondPerson / 3) + 0.10 * Math.min(1, f.intensifier / 2) +
            0.20 * (f.exclaim > 0 ? 1 : 0),
            0, 0.9,
          ))
          // A14 社会性线索：轻蔑/排斥（对方冲她说）
          if (/呵呵|随便你|关我什么事|你开心就好/.test(ev.text)) threatIn = Math.max(threatIn, 0.45)
          // A15 替代学习：对方难受，自己也紧一下
          if (/难受|崩溃|哭了|失眠|压力大|烦死/.test(ev.text)) s.threat = clamp(s.threat + 0.10, 0, 1)
          // A16 不确定性：模糊比确定更吓人
          if (/也许|可能|大概|不确定|不知道|看情况/.test(ev.text)) s.threat = clamp(s.threat + 0.05, 0, 1)
        }
        // A21 自我评价：她说了重话，自己也会被点着。
        // 以前靠 A01 顺带顶上来，现在 A01 只管对方，这一条要自己扛得住（+0.14）。
        if (ev.type === 'assistant' && /你行不行|做不好|随便|闭嘴|烦不烦|算了/.test(ev.text)) s.threat = clamp(s.threat + 0.14, 0, 1)
        warm = Math.max(warm, f.polarity > 0 ? 0.55 : 0)
        novelty = clamp(Math.abs(f.length - s.lastLen) / 40, 0, 1)
        cue = cueOf(f)
        s.lastKind = f.polarity > 0 ? 'positive' : (f.polarity < 0 || f.cold) ? 'negative' : 'neutral'
        s.lastLen = f.length
      }
      const hype = w.get('hypothalamus')
      const sleepDebt = hype?.sleepDebt ?? 0.2
      const before = s.threat

      // A12 敏化（不是线索级的那个）：反复受挫 → 触发阈值整体下移。
      // 用上一帧攒下的 frustration，算完再累加，避免同帧自激。
      const thr = clamp(1 - (1 - p.frustrateFloor) * s.frustration, p.frustrateFloor, 1)
      // A11 泛化：别的线索怕过，这条"样子像"的也会紧一下；
      // 但没线索的中性话不泛化（"今天天气不错"不该被听成刺）。
      let gen = 0
      // 泛化只在"这一拍真的被扎了一下"时生效（threatIn>0）：
      // 否则光凭线索相似度就会每拍加一份，没人惹她 threat 也会自己爬回 0.9。
      if (cue && threatIn > 0.02) {
        let worst = 0
        for (const [k, v] of Object.entries(s.sens)) if (k !== cue) worst = Math.max(worst, v)
        gen = p.generalizeDrive * Math.max(0, worst - 1)
        if (gen > 0) for (const k of Object.keys(s.sens)) if (k !== cue) s.generalized[k] = Math.max(gen, s.generalized[k] ?? 0)
      }
      const sensCue = cue ? (s.sens[cue] ?? 1) : 1
      // A01/A05/A12：进入量 → 过敏化、过阈值、过 NE 增益；A19 缺觉时同样的话更扎
      const drive = (threatIn / thr) * sensCue + gen
      s.threat = clamp(s.threat * decay(dt, p.tauThreat) +
        drive * (1 + 0.6 * s.ne) * (1 + 0.6 * sleepDebt), 0, 1)
      s.threat = Math.min(s.threat, before + p.threatStepCap)   // 单帧熔断
      s.fastThreat = s.threat
      s.rewardPE = warm > 0 ? clamp(warm - 0.1, -1, 1) : 0
      // 记忆先验：想起的事会先把威胁垫高一点（只读记忆，不写它）
      // 一次"想起"只扎一次：回声挂在**那一句话**上（引擎给 echo.at = 那次召回的时刻），
      // 安静下来以后同一份回声还会留在缓存里，但不该每拍再扎一遍。
      // 量纲：0.12 是"想起一件负性旧事"折算到 threat 的当场冲量（0..1，和单帧熔断同一层）。
      const echo = w.memoryEcho
      if (echo) {
        const neg = Math.max(0, -echo.tone)
        const pos = Math.max(0, echo.tone)
        // 没有 at 的合成回声（老测试/手工喂的）保持"每次都算"，不改变既有契约
        const echoKey = Number(echo.at)
        const fresh = !Number.isFinite(echoKey) || echoKey !== s.echoAt
        if (fresh) {
          if (Number.isFinite(echoKey)) s.echoAt = echoKey
          s.threat = clamp(s.threat + 0.12 * neg, 0, 1)
          s.rewardPE = clamp(s.rewardPE + 0.05 * pos, -1, 1)
        }
      }
      s.memSalience = w.memorySalience ?? null
      s.novelty = novelty
      s.cue = cue
      if (cue) s.lastCue = cue

      // A05 敏化 / A13 习惯化：同一条线索反复出现会先敏化、再钝化。
      // "还在学"的条件是：输入够扎，而且威胁还没顶到天花板（没有新东西可学了）。
      if (cue) {
        const learning = threatIn > p.sensThreshold && before < p.sensCeil
        if (learning) {
          s.sens[cue] = Math.min(p.sensMax, (s.sens[cue] ?? 1) + p.sensGain)
          s.exposures[cue] = (s.exposures[cue] || 0) + 1
        } else {
          // 他天天这么说，也就那样了
          s.sens[cue] = Math.max(1, (s.sens[cue] ?? 1) * p.habitRate)
        }
      }
      // A12：被真扎到的时候，那股劲会挂一会儿（阈值下移，30 分钟量级回弹）
      if (threatIn > 0.3) s.frustration = clamp(s.frustration + p.frustrateGain, 0, 1)

      // A06/A09 情境恐惧：场景本身会变成预测信号。
      const scene = String(w.scene || 'home')
      const ctxPrev = s.context[scene] ?? 0
      if (s.threat > 0.35) s.context[scene] = clamp(ctxPrev + p.contextLearn * (1 - ctxPrev), 0, 1)
      // 在怕过的场景里，威胁有一个 0.2*情境恐惧 的底——深夜的同一句话更容易被听成刺
      s.threat = clamp(Math.max(s.threat, p.contextFloor * (s.context[scene] ?? 0)), 0, 1)
      s.lastScene = scene

      // A20 僵住：极端威胁时身体先定住
      s.freeze = sat(s.threat * 3) * (s.threat > 0.75 ? 1 : 0.2)
      // A17 注意捕获：被吓到的**那一瞬**开一个 5 秒窗口（持续高唤醒不重复开窗，
      // 否则窗口永远不关，"5 秒"这件事就没了）。
      const wasHot = s.hotThreat === true
      if (s.threat > p.captureThreat && !wasHot) s.captureUntil = t1 + p.captureMs
      s.hotThreat = s.threat > p.captureThreat
      s.now = t1

      // A03/A18 显著性 + 情绪增强记忆
      s.salience = salienceOf()
      if (events.length && s.salience >= p.deepSalience) {
        // 这件事值得记牢：给海马体一个带保留期的标签（200 天）
        s.deepTags.push({
          cue: cue || s.lastCue || '',
          salience: Number(s.salience.toFixed(3)),
          at: t1,
          keepDays: p.deepKeepDays,
        })
        if (s.deepTags.length > p.deepKeepMax) s.deepTags = s.deepTags.slice(-p.deepKeepMax)
      }
      const cut = t1 - p.deepKeepDays * 86400_000
      if (s.deepTags.length) s.deepTags = s.deepTags.filter(t => Number(t.at) >= cut)
      s.frame += 1
    },

    /** B 段：慢回路修正（A02）、消退、泛化、情境 */
    step(w) {
      const dt = w.tx.dtMs
      const t1 = Number(w.tx.t1 ?? 0)
      const days = Math.max(0, dt) / 86400_000
      // 分钟数：下面几条都是"每分钟"的速率，不能写成"每拍"。
      // 宿主实测会按 2 秒一拍（面板轮询 + 消息事件），写成每拍等于把速率放大 30 倍。
      const dtMin = Math.max(0, dt) / 60_000
      // A02 慢评：归因到位后，威胁可被下调。
      // 已知残差：这一条仍然是"每拍 ×0.92"，不是按分钟——它按 60 秒一拍标定，
      // 起点也是"每句话一拍，几十秒到一分钟"。改成 0.92^分钟 会让 1 秒一拍的静置场景
      // 十分钟都静不下来（rate-audit 会红），也会让补算跨小时的那一拍把刚点着的威胁抹平（H11）。
      // 它只影响"威胁退多快"（往下降），不制造"威胁被加回来"，所以留在原样。
      const pfc = w.get('pfc')
      if (pfc && pfc.attribution) {
        if (pfc.attribution.locus === 'circumstance') s.threat *= 0.92
        if (pfc.attribution.confidence > 0.7 && s.threat > 0.3) s.threat *= 0.96
      }
      // A12 阈值回弹
      s.frustration = clamp(s.frustration * decay(dt, p.tauFrustration), 0, 1)
      // A08 自发恢复：安全记忆按"天"淡（两周 ≈ 0.65），不是按小时（那样 14 天等于归零）
      for (const k of Object.keys(s.safety)) s.safety[k] *= Math.pow(0.97, days)
      // A06 情境恐惧同样按天淡
      for (const k of Object.keys(s.context)) s.context[k] *= Math.pow(0.97, days)
      // A10 应激复现：皮质醇顶起来的时候，已经消退的旧恐惧会自己回来。
      // 一次应激只复现一次（不然每帧都在加），退了再允许下一次。
      const cortH = Number(w.get('hypothalamus')?.hpa?.cortisol ?? 0)
      const stressNow = Math.max(s.cort, cortH)
      if (stressNow > 0.6) {
        if (!s.stressEpisode) {
          s.stressEpisode = true
          const old = p.reinstatement * Math.max(maxOf(s.safety), maxOf(s.context))
          if (old > 0.02) s.threat = clamp(s.threat + old, 0, 1)
        }
      } else if (stressNow < 0.4) {
        s.stressEpisode = false
      }
      // M15 想起旧事 → 威胁被重新激活
      // 量纲：0.2 × reactivate 是"这一次回忆"折算到 threat 的冲量；按分钟摊开
      // （dtMin，最多算 1 分钟）——2 秒一拍时不会 30 倍地重复加。
      const react = clamp(Number(w.get('hippocampus')?.reactivate ?? 0), 0, 1)
      if (react) s.threat = clamp(s.threat + 0.2 * react * Math.min(1, dtMin), 0, 1)
      // tone
      s.ne = clamp(s.ne * decay(dt, p.tauNe) + 0.4 * s.fastThreat, 0, 1)
      s.cort = clamp(s.cort * decay(dt, p.tauCort) + 0.03 * s.threat, 0, 1)
      s.frame += 1
      s.now = t1
    },

    /** A15/A16/A21 由外部注入的事件 */
    inject({ vicarious = 0, uncertainty = 0, selfThreat = 0 } = {}) {
      if (vicarious) s.threat = clamp(s.threat + 0.1 * vicarious, 0, 1)
      if (uncertainty) s.threat = clamp(s.threat + 0.08 * uncertainty, 0, 1)
      if (selfThreat) s.threat = clamp(s.threat + 0.1 * selfThreat, 0, 1)
    },

    read() {
      const sensMax = Math.max(1, ...Object.values(s.sens))
      const salience = salienceOf()
      return {
        frame: s.frame,
        threat: s.threat, fastThreat: s.fastThreat, // K06 先有快评，后有慢评
        rewardPE: s.rewardPE, novelty: s.novelty,   // A04
        salience, ne: s.ne, cort: s.cort,
        sensMax, freeze: s.freeze, kind: s.lastKind, cue: s.cue,
        // A12 触发阈值：反复受挫后从 1 往下掉
        threshold: clamp(1 - (1 - p.frustrateFloor) * s.frustration, p.frustrateFloor, 1),
        // A11 泛化：怕过的线索 → 相似线索身上的余震
        generalized: { ...s.generalized },
        // A17 注意捕获：跟注入时钟比，不跟墙钟比（窗口开着就是 0.5，跟改造前一个量纲）
        capture: s.captureUntil > s.now ? 0.5 : 0,
        context: { ...s.context }, safety: { ...s.safety },
        // A18 情绪增强记忆：高显著事件的"留多久"标签
        deepTags: s.deepTags.map(t => ({ ...t })),
        retainDays: s.deepTags.length ? Math.max(...s.deepTags.map(t => t.keepDays)) : 0,
      }
    },
    snapshot: () => ({
      ...s,
      sens: { ...s.sens }, safety: { ...s.safety }, exposures: { ...s.exposures },
      context: { ...s.context }, generalized: { ...s.generalized },
      deepTags: s.deepTags.map(t => ({ ...t })),
    }),
    restore(o) {
      if (!o) return
      s = { ...fresh(), ...o }
      s.sens = { ...(o.sens || {}) }
      s.safety = { ...(o.safety || {}) }
      s.exposures = { ...(o.exposures || {}) }
      s.context = { ...(o.context || {}) }
      s.generalized = { ...(o.generalized || {}) }
      s.deepTags = Array.isArray(o.deepTags) ? o.deepTags.map(t => ({ ...t })) : []
    },
    health: () => ({ ok: true, degraded: false, frame: s.frame }),
  }
}


