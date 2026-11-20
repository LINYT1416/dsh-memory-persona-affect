// 前额叶皮层：刹车、方向盘、编剧。覆盖 P01-P23。
// 会累、会漏、会失败。永远理智的不是前额叶。

import { clamp, decay } from '../core/consts.js'

const P = {
  baseCap: 0.8, suppressionBase: 0.3, leakGain: 1.5,
  fatigueRate: 0.02, recoveryRate: 0.15,
  reappraisalCost: 0.15, reappraisalMax: 0.75,
}

// P08：这道口子以前只认"她自己说的重话"，可真实情况是**对方指出她做错了**——
// 那才是错误监测的主要输入。返工、被点破、被说糊弄，都算。
const BLAME = /不对|错了|又错|还是不行|没修好|没生效|怎么又|说了几遍|说了几次|骗我|糊弄|白改|做不好|不靠谱|离谱|搞砸|做砸|弄坏|改坏/
// P08 的另一半：错被认下来了（道歉/修复），监测该往下走，不是只涨不落。
const REPAIR = /对不起|抱歉|是我|我错|别生气|不怪你|原谅|辛苦你|不赖你|我急/
// P21：她开始往回倒带——"要是刚才没说就好了"。以前只有"负性预测误差"能触发，
// 可是人最先反事实的往往是**自己刚说出口的那句话**。
const COUNTERFACTUAL = /要是|如果|本来|早知道|不该|后悔|刚才不|说重了|换个说法|重说|何必/
// P19：给感觉命名。必须是"我 + (这/有点/真的…) + 情绪词"，不能把"我觉得你……"也算进来。
const EMOTION_WORD = '委屈|生气|难过|焦虑|害怕|失望|心痛|内疚|羞耻|厌烦|伤心|开心|高兴|紧张|心慌|烦'
// P23：赶时间是从话里认出来的，不是拿意义感凑数。
const HURRY = /赶时间|来不及|快点|赶紧|马上|没时间|要迟到|速度快/
// P13：越界（不只是威胁）——欺负/羞辱/歧视这类，和"被吓到"不是一回事。
const MORAL_CUE = /越界|太过分|过分了|欺负|羞辱|歧视|霸凌|不尊重|侮辱|拿人开涮|开这种玩笑/
const NAMING = new RegExp(`我(?:这|那)?(?:现在|此刻|心里|真的?|挺|有点|好|很|太|是|觉得|感觉|好像|可能)*\\s*(?:${EMOTION_WORD})`)
// 她自己把感觉说出口（P19 的原义）；同样要求后面真跟着情绪词。
const AST_NAMING = new RegExp(`我(?:有点|好像|可能|觉得|这是|现在|真的?)*\\s*(?:${EMOTION_WORD})`)

export function create(cfg = {}) {
  const p = { ...P, ...cfg }
  const fresh = () => ({
    bandwidth: 0.7, cap: 0.8, load: 0.3, fatigue: 0.1,
    slots: 4, suppression: 0.3, mask: 0.3,
    toneShift: 'normal', brevity: 0.3, leakRisk: 0.2,
    attribution: { locus: 'other', stability: 'temporary', globality: 'specific', blame: '他', confidence: 0.5 },
    reappraisal: { strategy: 'none', success: false, cost: 0, at: 0 },
    conflict: 0, delay: { urge: 0, resisted: false, at: 0 },
    decision: { speak: true, now: true, yield: false, hold: false },
    repair: 0, timePressure: 0, pfcGain: 0.5,
    labeling: 0, selfRef: 0.5, counterfactual: 0, regret: 0, moral: 0,
    rules: 0.7,
    error: 0,
    frame: 0,
  })
  let s = fresh()

  return {
    id: 'pfc',
    cover: ['P01', 'P02', 'P03', 'P04', 'P05', 'P06', 'P07', 'P08', 'P09', 'P10', 'P11', 'P12', 'P13', 'P14', 'P15', 'P16', 'P17', 'P18', 'P19', 'P20', 'P21', 'P22', 'P23', 'C05'],
    params: p,

    step(w) {
      const dt = w.tx.dtMs
      const h = clamp(dt / 3600_000, 0, 24)
      const hyp = w.get('hypothalamus')
      const amy = w.get('amygdala')
      const ins = w.get('insula')
      const hip = w.get('hippocampus')
      const soc = w.get('social')
      if (!hyp) return

      const felt = ins?.felt.intensity ?? 0
      const threat = amy?.threat ?? 0
      const events = Array.isArray(w.tx?.events) ? w.tx.events : []
      // 这一拍她听见的话：用户说的 / 她自己说的。
      // 以前这里只看"她说的"，于是 P08/P19/P21 三个口子对用户那句**完全瞎**。
      const userText = events.filter(e => e.type === 'user').map(e => String(e.text || '')).join(' ').trim()
        || String(w.lastUserText ?? '')
      const astText = events.filter(e => e.type === 'assistant').map(e => String(e.text || '')).join(' ')

      // P02/P03 抑制：想露多少 vs 该露多少
      const relationship = soc?.relationship ?? 'close'
      const want = clamp(0.4 + 0.6 * felt, 0, 1)
      const should = relationship === 'stranger' ? 0.35 : threat > 0.5 ? 0.4 : 0.62
      s.suppression = clamp(p.suppressionBase + 0.4 * (want - should), 0, 0.95)
      s.mask = s.suppression
      s.brevity = clamp(0.3 + 0.5 * s.suppression, 0, 1)

      // P08 错误监测：被指出做错 → 不适上升；道歉/修好 → 回落。
      // 以前只在"她自己说了重话"时涨，而且涨完立刻被下面一行 conflict 覆盖掉，
      // 所以 error 既不响应输入，也不影响任何东西。
      let blamed = 0
      for (const ev of events) {
        if (ev.type === 'user' && BLAME.test(String(ev.text || ''))) blamed = Math.max(blamed, 1)
        if (ev.type === 'assistant' && /你行不行|做不好|随便|闭嘴|烦不烦|算了/.test(String(ev.text || ''))) blamed = Math.max(blamed, 0.7)
      }
      if (blamed) s.error = clamp(s.error + 0.22 * blamed, 0, 1)
      const mended = REPAIR.test(userText) || REPAIR.test(astText)
      if (mended && s.error > 0.05) {
        s.error = clamp(s.error * 0.35, 0, 1)
        s.repair = clamp(s.repair + 0.15, 0, 1)
      }
      s.error = clamp(s.error * decay(dt, 20), 0, 1)

      // P07 冲突：想说 vs 该说 + 想认错 vs 想嘴硬 + 憋着的那股劲
      s.conflict = clamp(
        Math.abs(want - should) * 0.7
        + 0.25 * s.error
        + 0.3 * s.delay.urge
        + 0.15 * s.suppression * clamp(felt + threat, 0, 1),
        0, 1,
      )

      // P16 带宽：受下丘脑上限、疲劳、情绪占用、资源池（C01）影响；取 min 不相乘（C05）
      const lim = w.limits?.inhibit ?? 1
      const cap = Math.min(p.baseCap, hyp.bandwidthCap, 1 - 0.25 * s.fatigue) * (0.7 + 0.3 * lim)
      const busy = clamp((events.length + (w.queue ?? 0)) / 5, 0, 1)
      s.load = clamp(
        0.35 * s.suppression + 0.25 * clamp(felt - 0.5, 0, 1)
        + 0.2 * s.conflict + 0.1 * busy + 0.15 * s.error,
        0, 1,
      )
      // P01 工作记忆槽位：不能只数"这一拍几条消息"——心里压着的事（负荷/冲突/刚犯的错）
      // 也占格子。以前一条消息永远是 4 格，等于这个字段没在跑。
      const occupied = clamp(busy + 0.55 * s.load + 0.3 * s.error + 0.15 * s.conflict, 0, 1)
      s.slots = clamp(4 - Math.floor(occupied * 3), 1, 4)
      // P03 泄漏风险：用上一拍的带宽（这一拍的带宽下面才算），保持原来的时间关系
      s.leakRisk = clamp((1 - s.bandwidth) * s.suppression * p.leakGain, 0, 1)
      s.cap = cap
      s.bandwidth = clamp(s.bandwidth * decay(dt, 60) + (cap - s.load) * (1 - Math.exp(-h * 2)), 0, 1)
      // 接口一致性：带宽永远不许超过上限
      s.bandwidth = Math.min(s.bandwidth, s.cap)

      // P04 重评：三条件 + 冷却（不能每帧都重评，否则带宽被自己吃掉）
      const evidence = hip?.recall?.hit || (hip?.count ?? 0) > 0
      // M13 图式：如果她已经有"他就是这样"的结论，重评会被挡住
      const schemaBlocks = (hip?.schemas ?? []).some(x => x.confidence > 0.7)
      const sinceTry = w.tx.t1 - (s.reappraisal.at || 0)
      const can = s.bandwidth > 0.3 && evidence && threat > 0.3 && sinceTry > 300_000 && !schemaBlocks
      const roll = w.rng()
      if (can && roll < p.reappraisalMax) {
        // P15 调节策略选择：按关系挑策略
        s.reappraisal = { strategy: pickStrategy(relationship), success: true, cost: p.reappraisalCost, at: w.tx.t1 }
        s.bandwidth = clamp(s.bandwidth - p.reappraisalCost, 0, 1)
      } else if (can) {
        s.reappraisal = { strategy: 'failed', success: false, cost: 0.1, at: w.tx.t1 }
        s.bandwidth = clamp(s.bandwidth - 0.1, 0, 1)
      } else if (threat > 0.3 && (s.load > 0.5 || s.bandwidth <= 0.3)) {
        // P15 调节策略选择：带宽不够/心里太满时，人不会硬去重评，而是先压住。
        s.reappraisal = { strategy: '压抑', success: false, cost: 0.04, at: w.tx.t1 }
      }

      // P06 价值整合：值不值得为这事翻脸
      s.value = clamp(0.5 + 0.4 * (soc?.trust ?? 0.6) - 0.3 * threat + 0.2 * (soc?.comfort ?? 0), 0, 1)
      // P12 心理理论：带宽够才猜得准对方
      s.theoryOfMind = clamp(0.3 + 0.5 * s.bandwidth + 0.2 * (soc?.trust ?? 0.6), 0, 1)
      // P18 自上而下注意控制
      s.topDown = clamp(s.bandwidth * 0.9, 0, 1)
      // P20 自我参照：说的是"我"还是"他"，权重不一样。
      const ownTalk = /我(?!们)/.test(userText) && !/他|她/.test(userText)
      const otherTalk = /他|她/.test(userText) && !/我(?!们)/.test(userText)
      s.selfRef = clamp(0.5 + 0.3 * (soc?.selfOther ?? 0.5) + (ownTalk ? 0.14 : otherTalk ? -0.08 : 0), 0, 1)

      // P11 归因（带置信度）
      const hostile = (w.get('bias')?.hostile ?? 0)
      // P11：被指出做错，第一反应是"是我的问题"；老路子（负性 PE）在这套里到不了，
      // 所以以前 self 这一格永远出不来，内疚/羞耻也就永远被 F 掉。
      const selfBlame = blamed > 0 || ((amy?.rewardPE ?? 0) < -0.2 && threat < 0.2)
      s.attribution = selfBlame
        ? { locus: 'self', stability: 'temporary', globality: 'specific', blame: '自己', confidence: 0.7 }
        : threat > 0.6
          ? { locus: 'other', stability: hostile > 0.6 ? 'stable' : 'temporary', globality: hostile > 0.6 ? 'global' : 'specific', blame: '他', confidence: 0.45 + 0.3 * hostile }
          : { locus: 'circumstance', stability: 'temporary', globality: 'specific', blame: '环境', confidence: 0.5 }

      // P14 表达规则
      const displayRules = relationship === 'stranger' ? 0.2 : relationship === 'close' ? 0.7 : 0.4
      s.rules = displayRules
      const valence = clamp((amy?.rewardPE ?? 0) - 0.7 * threat, -1, 1)
      s.toneShift = s.bandwidth < 0.15 ? 'flat'
        : (valence < -0.25 || felt > 0.45 || s.suppression > 0.55) ? 'hard'
          : (valence > -0.05 && threat < 0.15 && felt < 0.3) ? 'soft' : 'normal'

      // P05 消退增益（给杏仁核）
      s.pfcGain = clamp(s.bandwidth * (1 - 0.3 * hyp.sleepDebt), 0, 1)

      // P09 延迟满足：想说又忍住（urge 是那股"立刻就想说出来"的劲）
      const urgeIn = clamp(
        0.55 * threat + 0.5 * felt + 0.45 * s.suppression + 0.6 * s.error + 0.35 * s.conflict,
        0, 1,
      )
      // 注意时间常数：这里按"分钟"算，不能拿小时当指数（dt 是一分钟时 (1-e^{-h*2}) 只有 0.03，
      // 那股劲永远涨不起来，hold 也就永远不会真）。
      const urgeK = 1 - Math.exp(-(dt / 60_000) / 2)
      s.delay.urge = clamp(s.delay.urge + (urgeIn - s.delay.urge) * urgeK, 0, 1)
      if (!s.delay.resisted && s.delay.urge > 0.5 && s.bandwidth > 0.3) {
        s.delay.resisted = true
        s.delay.at = w.tx.t1
      }
      // 憋满十分钟：这股劲泄掉一半，不再硬压着（一直压着就不是人了）
      if (s.delay.resisted && w.tx.t1 - (s.delay.at || 0) > 600_000) {
        s.delay.resisted = false
        s.delay.urge = clamp(s.delay.urge * 0.4, 0, 1)
        s.delay.at = w.tx.t1
      }

      // P10 决策：以前这一步排在 P09 前面算，hold 读的是上一拍的 resisted；
      // 而且三个出口只看带宽，带宽几乎不动 → 永远是同一套答案。
      // 现在按"是不是正憋着"分叉：高冲突时先忍住，不是每一拍都"说/现在/让"。
      const holding = s.delay.resisted && s.delay.urge > 0.45
      s.decision = {
        speak: s.bandwidth > 0.15 && !holding,
        now: s.bandwidth > 0.35 && !holding && s.conflict < 0.65,
        yield: s.value > 0.55 && threat < 0.55 && !holding,   // P06：值不值得低头
        hold: holding,
      }

      // P19 命名：给感觉叫出名字（"我这是委屈"／她自己说出口"我有点……"）。
      // 以前只认她话里的"我觉得"，而且 io.labeled 从来没人置 1 —— 等于这个口子全死。
      // 命名不是永远有效：说出来轻一阵子，之后标签会淡掉。
      s.labeling = clamp(s.labeling * decay(dt, 25), 0, 1)
      let named = 0
      if (NAMING.test(userText)) named = 1
      if (AST_NAMING.test(astText)) named = Math.max(named, 0.8)
      if (named) {
        s.labeling = clamp(s.labeling + 0.85 * named, 0, 1)
        s.conflict = clamp(s.conflict * 0.85, 0, 1)   // 说清楚了，心里那股拧劲松一点
        s.load = clamp(s.load * 0.95, 0, 1)
        w.labeled = true                              // 给 io 通道（P19/O13）
      }
      // io 通道也报了命名：同一件事下一拍再松一点，不重复加太多
      const label = (w.get('io')?.labeled ?? 0)
      if (label) s.labeling = clamp(s.labeling + 0.25, 0, 1)

      // P21 反事实 / P17 后悔：她开始往回倒带——"刚才要是不那样就好了"
      s.counterfactual = clamp(s.counterfactual * decay(dt, 90), 0, 1)
      if (COUNTERFACTUAL.test(userText)) s.counterfactual = clamp(s.counterfactual + 0.45, 0, 1)
      else if (COUNTERFACTUAL.test(astText)) s.counterfactual = clamp(s.counterfactual + 0.3, 0, 1)
      if ((amy?.rewardPE ?? 0) < -0.3) s.counterfactual = clamp(s.counterfactual + 0.2, 0, 1)
      // 知道自己说错了，会往回倒带（P08 → P21 的通路）
      if (blamed) s.counterfactual = clamp(s.counterfactual + 0.1, 0, 1)
      s.regret = clamp(s.counterfactual * 0.5 + s.conflict * 0.3, 0, 1)

      // P22 事后找补：说重了会补一句
      if ((threat > 0.35 || s.error > 0.1) && s.bandwidth > 0.4 && s.repair < 1) s.repair = clamp(s.repair + 0.1, 0, 1)

      // P23 时间压力：赶时间时压住情绪（话变短、装没事、先把事办完）
      const tpTarget = HURRY.test(userText)
        ? 0.75
        : clamp(0.05 + 0.1 * (hyp?.needs?.meaning ?? 0), 0, 0.3)
      s.timePressure = clamp(s.timePressure + (tpTarget - s.timePressure) * (1 - Math.exp(-(dt / 60_000) / 2)), 0, 1)
      if (s.timePressure > 0.5) {
        s.suppression = clamp(s.suppression + 0.1, 0, 0.95)
        s.mask = clamp(s.mask + 0.1, 0, 0.95)
        s.brevity = clamp(s.brevity + 0.05, 0, 1)
      }

      // 疲劳：只有在真歇着（这一拍没人说话、且隔了二十分钟以上）才回血。
      // 以前不管聊不聊都在恢复，于是聊三十轮疲劳反而越来越低——越聊越精神，不像人。
      const talking = w.tx.events.some(e => e.type === 'user')
      const resting = !talking && w.tx.dtMs > 20 * 60_000
      s.fatigue = clamp(s.fatigue + p.fatigueRate * h * (s.suppression + 0.4) - (resting ? p.recoveryRate * h * (hyp.sleepDebt < 0.3 ? 1 : 0.3) : 0), 0, 1)
      s.selfRef = clamp(0.5 + 0.3 * (soc?.selfOther ?? 0.5) + (ownTalk ? 0.14 : otherTalk ? -0.08 : 0), 0, 1)
      // P13 道德判断：越界的事一出现就记一笔，不是只在威胁 >0.6 时按拍累加
      if (MORAL_CUE.test(userText)) s.moral = clamp(s.moral + 0.45, 0, 1)
      s.moral = clamp(s.moral * 0.99 + (threat > 0.6 ? 0.05 : 0), 0, 1)
      s.frame += 1
    },

    read() {
      return {
        frame: s.frame,
        bandwidth: s.bandwidth, cap: s.cap, load: s.load, fatigue: s.fatigue, slots: s.slots,
        display: { mask: s.mask, toneShift: s.toneShift, brevity: s.brevity, leakRisk: s.leakRisk, rules: s.rules ?? 0.7 },
        attribution: { ...s.attribution },
        reappraisal: { ...s.reappraisal },
        conflict: s.conflict,
        decision: { ...s.decision },
        pfcGain: s.pfcGain,
        repair: s.repair,
        regret: s.regret,
        error: s.error,
        value: s.value,
    theoryOfMind: s.theoryOfMind,
    topDown: s.topDown,
    moral: s.moral,
    selfRef: s.selfRef,
    labeling: s.labeling,
        timePressure: s.timePressure,
      }
    },
    snapshot: () => ({ ...s, attribution: { ...s.attribution }, reappraisal: { ...s.reappraisal }, decision: { ...s.decision } }),
    restore(o) { if (o) s = { ...fresh(), ...o } },
    health: () => ({ ok: true, degraded: false, frame: s.frame }),
  }
}

function pickStrategy(rel) {
  const pool = rel === 'close' ? ['换框架', '找反例', '拉远'] : ['拉远', '接受']
  return pool[Math.floor(Math.random() * pool.length)]
}
