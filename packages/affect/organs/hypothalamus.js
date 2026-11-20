// 下丘脑：需求、节律、HPA、自主神经、周期。覆盖 H01-H20。

import { clamp, decay, gauss, hourOf, nightFraction } from '../core/consts.js'

const P = {
  hungerRate: 0.06, contactRate: 0.10, thirstRate: 0.055,
  cortTau1: 8, cortTau2: 70,
  // H04 睡眠效率：睡着时每小时放掉多少睡眠压力。原代码里那句 `* eff` 的 eff 就是这个系数：
  // 某次改动把定义删了、只剩引用，于是只要夜里"长间隔 + 没在说话"走到睡着分支，
  // 就会 ReferenceError（整只下丘脑被引擎回滚，后面 H19/H15/H16 全都不执行）。
  // 健康成年人睡眠效率 85%~95%，取 0.9。
  sleepEff: 0.9,
  // H19 咖啡因半衰 5h：一室模型 tau = 5h / ln2 ≈ 432.8min
  // （原来写死 300，等于半衰 3.5h，测出来 5h 只剩 0.37）。
  caffeineTauMin: 300 / Math.LN2,
}

// 从对话里读的几类输入。宿主在 web 会话里不发 activity/sick 事件，
// 所以病感、咖啡因都只能从"她听到的这句话"里认，否则这些字段永远是初值。
const SICK_RX = /发烧|发热|低烧|生病|病了|感冒|咳嗽|嗓子疼|头疼|头痛|浑身没劲|没力气|浑身疼|不舒服|胃疼|拉肚子|吃药/
const COFFEE_RX = /咖啡|拿铁|美式|意式|espresso|奶茶|红牛|能量饮料|茶/
const FOOD_RX = /吃了|吃完|外卖|泡面|做饭|面条|面包|火锅|烧烤|零食|吃面/
const OFFEND_RX = /冒犯|不尊重|凭什么|管你|关你|轮不到你|你算什么东西|挑衅|顶撞|少管|别管我|你懂什么|谁给你的胆|看不起|不许你|闭嘴|滚蛋|废物|白痴|少废话/
// H02 喝水：渴是可以被解掉的，不然"6 小时没喝水"就只是一个计时器。
const DRINK_RX = /喝水|喝了.{0,4}水|水杯|白水|矿泉水|灌了口水|喝口/
// H01/H17 冷：缺口感 + 耐心。
const COLD_RX = /好冷|太冷|冻(?:死|得|僵)|冷死|凉飕飕|打哆嗦|发冷|手都僵/
// H10 亲密：依恋激素上来，应激回得更快。
const INTIMATE_RX = /抱抱|抱一下|亲(?:亲|一下|你)|喜欢你|爱你|想你|贴贴|黏你/

export function create(cfg = {}) {
  const p = { ...P, ...cfg }
  const fresh = () => ({
    hunger: 0.28, thirst: 0.2, sleep: 0.15, warmth: 0.1,
    contact: 0.35, control: 0.2, meaning: 0.2,
    sleepDebt: 0.15, cortisol: 0.15, ne: 0.1, stressLoad: 0,
    sleepGate: 1, energyAlloc: 1,    sym: 0.3, par: 0.6,
    temp: 0.1, pain: 0.15, painGate: 1,
    oxytocin: 0.3, vasopressin: 0.3, testosterone: 0.5,
    estrogen: 0.5, cycleDay: 14, cycleOn: cfg?.cycle?.on !== false, cycleStart: cfg?.cycle?.lastStart ?? null, cycleLen: cfg?.cycle?.len || 28,
    stimulant: 0, caffeine: 0,
    aggression: 0.1, freeze: 0, sick: 0,
    meal: 0, cold: 0, now: 0,
    frame: 0,
  })
  let s = fresh()

  const wave = (h) =>
    // H05 昼夜节律：双相波，不用随机游走
    0.55 + 0.25 * gauss(h, 10, 3) + 0.20 * gauss(h, 20, 2.5) - 0.18 * gauss(h, 15, 2) - 0.25 * gauss(h, 3.5, 2)

  return {
    id: 'hypothalamus',
    cover: ['H01', 'H02', 'H03', 'H04', 'H05', 'H06', 'H07', 'H08', 'H10', 'H11', 'H12', 'H13', 'H14', 'H15', 'H16', 'H17', 'H18', 'H19', 'H20'],
    params: p,

    step(w) {
      const dt = Number.isFinite(w?.tx?.dtMs) ? w.tx.dtMs : 0
      const h = clamp(dt / 3600_000, 0, 24)
      const events = Array.isArray(w?.tx?.events) ? w.tx.events : []
      const amy = w.get('amygdala')
      const threat = amy?.threat ?? 0
      const hour = hourOf(w.tx.t1)
      const night = hour >= 23 || hour < 6
      const nightTalking = events.some(e => e?.type === 'user')

      // H16 病感信号自然消退（一天量级）。宿主不发病感事件时，它就是"生病"的唯一来源。
      s.sick = clamp(Number(s.sick ?? 0) * decay(dt, 1440), 0, 1)

      // H03 饿到一定程度会自己去吃（不需要谁提醒）
      if (s.hunger > 0.85 && !nightTalking) {
        s.hunger = 0.2
        s.ateAt = w.tx.t1
      }

      // H13 进食 / H19 咖啡因 / H16 生病 / T06 被冒犯：先读这一拍的话，再算各条公式。
      // 以前这段在 step 末尾，咖啡因要等下一拍才进 stimulant（而且那行每拍加 0.18，
      // 两拍就顶到 1）——顺序和增量都得改。
      let offense = 0
      for (const ev of events) {
        if (!ev) continue
        const text = String(ev.text || '')
        const kind = String(ev.kind || '')
        if (ev.type === 'activity') {
          if (/吃|饭/.test(kind)) { s.hunger = 0.2; s.ateAt = w.tx.t1; s.meal = 1 }
          if (/睡/.test(kind)) s.sleepDebt = Math.max(0, s.sleepDebt - 0.4)
          if (SICK_RX.test(kind)) s.sick = Math.max(s.sick, 0.5)
        } else if (ev.type === 'user') {
          if (COFFEE_RX.test(text)) s.caffeine = clamp(s.caffeine + 0.3, 0, 1)
          if (FOOD_RX.test(text)) { s.hunger = Math.max(0.1, s.hunger - 0.35); s.meal = 1 }
          if (DRINK_RX.test(text)) s.thirst = Math.max(0.05, s.thirst - 0.3)
          if (COLD_RX.test(text)) { s.warmth = clamp(s.warmth + 0.22, 0, 1); s.cold = 1 }
          if (INTIMATE_RX.test(text)) s.oxytocin = clamp(s.oxytocin + 0.4, 0, 1)
          if (SICK_RX.test(text)) s.sick = Math.max(s.sick, 0.7)
          if (OFFEND_RX.test(text)) offense = Math.max(offense, 0.6)
        }
      }

      // H03/H02/H17 需求漂移
      // 这里必须只按"过了多少小时"涨。以前额外挂了个 +0.05 的常数，
      // 等于每拍加 5 个点——面板每秒刷新一次就是每秒涨 5 点，看着像发疯。
      s.hunger = clamp(s.hunger + p.hungerRate * h * (night ? 1.2 : 1), 0, 1)
      s.thirst = clamp(s.thirst + p.thirstRate * h, 0, 1)
      s.sleep = clamp(s.sleep + 0.05 * h * (night ? 2 : 1), 0, 1)
      // 社交/掌控/意义/温度：各有漂移，也有被满足的路径
      s.contact = clamp(s.contact + (nightTalking ? -0.05 : 0.10 * h), 0, 1)
      s.control = clamp(s.control + (threat > 0.5 ? 0.08 * h : -0.03 * h), 0, 1)
      s.meaning = clamp(s.meaning + 0.004 * h, 0, 1)
      s.warmth = clamp(s.warmth + (night ? 0.02 * h : -0.02 * h), 0, 1)
      // H01/H13/H17：冷和"刚吃过"都是余温，按分钟量级散，不是一帧清零。
      s.cold = clamp(s.cold * decay(dt, 30), 0, 1)
      s.meal = clamp(s.meal * decay(dt, 120), 0, 1)
      s.now = w.tx.t1
      // H04 睡眠：按区间里"落在夜里"的比例还睡眠债；正在说话只减半，不整段扣掉
      const nightFrac = nightFraction(w.tx.t0, w.tx.t1)
      // 睡着才补觉：夜里还在说话（醒着）只会更欠觉，不会自己回血
      const asleep = !nightTalking && w.tx.dtMs > 20 * 60_000
      // eff = 睡眠效率。这里以前直接引用了这个从没定义过的变量，
      // 于是任何一次夜里关机 >20 分钟的补算都会抛错、被引擎整段回滚——
      // H04 的还睡眠债从来没生效过。按 1（正常睡眠）算，跟原意一致。
      const eff = 1
      if (nightFrac > 0.05 && asleep) {
        s.sleepDebt = clamp(s.sleepDebt - 0.15 * h * nightFrac, 0, 1)
        s.sleep = clamp(s.sleep - 0.2 * h * nightFrac * p.sleepEff, 0, 1)
      } else {
        s.sleepDebt = clamp(s.sleepDebt + 0.03 * h, 0, 1)
      }
      // H14 预期性：饭点前加速（同样按小时算，不能每一拍都加一点）
      if (hour > 11 && hour < 12.5) s.hunger = clamp(s.hunger + 0.06 * h, 0, 1)

      // H06 HPA 二阶（解析解）
      const k1 = 1 - Math.exp(-h * 60 / p.cortTau1)
      const k2 = 1 - Math.exp(-h * 60 / p.cortTau2)
      // H11：连着应激（stressLoad 攒起来）之后受体下调——同样的威胁，HPA 的反应变钝；
      // 底噪由 stressLoad 自己垫一点，不是"越应激越敏感"。
      const drive = threat * 0.8 * (1 - 0.85 * s.stressLoad) * (1 - 0.4 * s.oxytocin) + 0.15 * s.stressLoad
      s.cortisol = clamp(s.cortisol + (drive - s.cortisol) * k1 * 0.5, 0, 1)
      // H10：被亲密对待之后，催产素把刹车踩深一点，皮质醇退得更快。
      s.cortisol = clamp(s.cortisol - s.cortisol * k2 * 0.25 * (1 + 0.9 * s.oxytocin), 0, 1)
      // H10 恢复加快：催产素还多开一条清除通路（35 分钟量级），不是只把刹车踩深。
      s.cortisol = clamp(s.cortisol - s.cortisol * (1 - Math.exp(-h * 60 / 35)) * 0.5 * s.oxytocin, 0, 1)
      // H11 应激累积与受体下调
      // 单帧熔断把 threat 卡在 0.35 上下，边界要算"够到"而不是"超过"
      s.stressLoad = clamp(s.stressLoad + (threat >= 0.34 ? 0.03 : -0.01) * h, 0, 1)

      // H07 自主神经
      // 以前写的是 * 0.25 * Math.min(1, h*4 + 0.2)：那个 +0.2 等于"每一拍至少走 20% 的一步"，
      // 面板一秒刷新一次，交感/副交感就每拍走 5%，心率几分钟能跑十几点。改成按时间常数收敛。
      const aSym = 1 - Math.exp(-h / (3 / 60))   // 3 分钟量级
      const aPar = 1 - Math.exp(-h / (5 / 60))   // 5 分钟量级
      s.sym = clamp(s.sym + (0.25 + 0.6 * threat + 0.2 * s.stimulant - s.sym) * aSym, 0, 1)
      s.par = clamp(s.par + (0.7 - 0.3 * threat - s.par) * aPar, 0, 1)

      // H19 咖啡因半衰 5h：浓度按一室模型衰减，唤醒抬升快跟着浓度走（20 分钟量级）。
      // 以前是 `+ caffeine*0.6` 每拍硬加，跟 dt 无关：一分钟一拍时两拍就饱和到 1，
      // 再等 5 小时也回不到一半。
      s.caffeine = clamp(s.caffeine * decay(dt, p.caffeineTauMin), 0, 1)
      const stimTarget = clamp(0.6 * s.caffeine, 0, 1)
      const aStim = 1 - Math.exp(-h / (10 / 60))   // 10 分钟量级上去/下来
      s.stimulant = clamp(s.stimulant + (stimTarget - s.stimulant) * aStim, 0, 1)

      // A20 极端威胁 → 僵住（给上层"停住/话变短"用）。威胁退下去它自己跟着退。
      const freezeTarget = threat > 0.6 ? clamp((threat - 0.6) / 0.4, 0, 1) : 0
      const aFreeze = 1 - Math.exp(-h / (2 / 60))   // 2 分钟量级
      s.freeze = clamp(s.freeze + (freezeTarget - s.freeze) * aFreeze, 0, 1)

      // T06 加压素：被冒犯/被顶撞时升高（90 分钟量级回落），强威胁也带一点
      const vasoIn = Math.max(offense, threat > 0.6 ? (threat - 0.6) * 1.2 : 0)
      s.vasopressin = clamp(s.vasopressin * decay(dt, 90) + 0.45 * vasoIn, 0, 1)

      // H08 攻击：威胁 × 管不住 × 睾酮（E04 从上一帧读）
      const test = w.get('endocrine')?.testosterone ?? 0.5
      s.aggression = clamp((0.1 + 0.7 * threat * (1 - (w.get('pfc')?.bandwidth ?? 0.6))) * (1 + 0.3 * (test - 0.5)), 0, 1)
      // B01/B02 呼吸与心率由脑干给（上一帧），这里只做兜底
      const bs = w.get('brainstem')
      s.bsHr = bs?.heartRate ?? null
      s.bsBreath = bs?.respiration ?? null
      // H12 疼痛门控
      s.painGate = clamp(1 - 0.6 * s.sym, 0.3, 1)
      // H10 依恋激素
      s.oxytocin = clamp(s.oxytocin + (0.3 - s.oxytocin) * (1 - decay(dt, 120)), 0, 1)

      // H15 周期：默认开；按距离上次开始的天数算相位。
      // 起点必须在第一次 step 时对齐引擎时钟——以前用 Date.now() 兜底，
      // 注入固定时钟（测试/补算）时会算成"离上次开始 -6 天"，cycleDay 永远是同一个值。
      if (s.cycleOn) {
        if (s.cycleStart == null) s.cycleStart = w.tx.t1 - 12 * 86400_000
        const rawStart = typeof s.cycleStart === 'number' ? s.cycleStart : new Date(s.cycleStart).getTime()
        const startMs = Number.isFinite(rawStart) ? rawStart : w.tx.t1 - 12 * 86400_000
        const len = Math.max(20, Number(s.cycleLen) || 28)
        const days = Math.floor((w.tx.t1 - startMs) / 86400_000)
        s.cycleDay = ((days % len) + len) % len + 1
        const pre = s.cycleDay > len - 4     // 经前
        const period = s.cycleDay <= 5       // 经期
        s.cyclePhase = period ? '经期' : pre ? '经前' : '平常'
        // E03：相位定雌激素的基调；内分泌层只当个体差异，不能把相位抹平成 0.5
        const phaseE = period ? 0.3 : pre ? 0.35 : 0.6
        const endoE = Number(w.get('endocrine')?.estrogen)
        s.estrogen = clamp(Number.isFinite(endoE) ? phaseE + 0.5 * (endoE - 0.5) : phaseE, 0.1, 1)
      } else {
        s.cyclePhase = null
        s.estrogen = 0.5
      }
      // H16 能量分配：生病时省电（病感层有值就听它，没有就用这一拍从话里读到的病感）
      const sickSup = w.get('sickness') ?? {}
      const inflammation = Math.max(clamp(Number(sickSup.inflammation) || 0, 0, 1), Number(s.sick) || 0)
      const fatigue = Math.max(clamp(Number(sickSup.fatigue) || 0, 0, 1), (Number(s.sick) || 0) * 0.8)
      s.energyAlloc = clamp(1 - 0.3 * inflammation - 0.2 * fatigue, 0.1, 1)

      // H18 入睡/醒来：深夜且睡眠压力高时，反应变慢
      s.sleepGate = clamp(1 - (night ? 0.35 : 0) - s.sleepDebt * 0.25, 0.25, 1)
      // H10 依恋激素：与内分泌模块对齐（上一帧）
      const endo = w.get('endocrine')
      if (endo) {
        // H10：依恋激素取"下限对齐"，不是每拍被覆盖回去——
        // 刚被抱过的余温不能被一帧内分泌读数抹平。
        s.oxytocin = Math.max(clamp(s.oxytocin, 0, 1), Number(endo.oxytocin) || 0)
        s.testosterone = endo.testosterone
      }
      s.ne = amy?.ne ?? s.ne
      s.frame += 1
    },

    read() {
      const hour = hourOf(s.now || Date.now())
      const energyWave = wave(hour)
      const energy = clamp(energyWave * (1 - 0.5 * s.sleepDebt) * (1 - 0.2 * s.hunger) * (s.energyAlloc ?? 1), 0, 1)
      const thresholdShift = clamp(-0.3 * s.sleepDebt - 0.15 * s.hunger - 0.1 * Math.max(0, s.cortisol - 0.5)
        - (s.cyclePhase === '经前' ? 0.2 : s.cyclePhase === '经期' ? 0.15 : 0)
        - 0.08 * s.cold, -0.6, 0.2)
      // H13 奖赏性进食：吃这件事本身就值 +0.05 上下的心情（不靠"饿少了"间接算）
      const moodBias = clamp(0.15 * (energy - 0.5) - 0.1 * s.sleepDebt + 0.06 * s.meal, -0.3, 0.2)
      const heartRate = clamp(60 + 45 * s.sym - 10 * s.par + 8 * s.cortisol, 45, 140)
      // H17 体温：下午高、深夜低（有来源，不是摆设）
      const temp = clamp(0.25 * Math.cos(((hour - 14) / 24) * 2 * Math.PI) - 0.1 * s.sleepDebt, -1, 1)
      // H12 疼痛：久坐 + 缺觉会酸；没有外部疼痛事件时的基线
      const pain = clamp(0.05 + 0.3 * s.sleepDebt + 0.15 * (1 - energy), 0, 1)
      s.temp = temp
      s.pain = pain
      return {
        frame: s.frame,
        body: {
          hr: s.bsHr ?? heartRate,
          hrv: clamp(85 - 40 * s.sym - 20 * s.sleepDebt, 10, 120),
          breath: s.bsBreath ?? clamp(12 + 8 * s.sym, 6, 30),
          gut: clamp(-0.6 * s.sym - 0.3 * s.hunger, -1, 1),
          temp,
          tension: clamp(0.3 + 0.5 * s.sym, 0, 1),
          pain: clamp(pain * s.painGate, 0, 1),
        },
        needs: { hunger: s.hunger, thirst: s.thirst, sleep: s.sleep, contact: s.contact, control: s.control, meaning: s.meaning, warmth: s.warmth },
        hpa: { cortisol: s.cortisol, ne: s.ne },
        rhythm: { energy, moodBias, thresholdShift },
        sleepDebt: s.sleepDebt,
        sleepGate: s.sleepGate,
        bandwidthCap: clamp((0.9 - 0.5 * s.sleepDebt - 0.3 * s.hunger - 0.1 * s.stressLoad) * s.sleepGate, 0.2, 1),
        autonomic: { sym: s.sym, par: s.par },
        hormones: { oxytocin: s.oxytocin, vasopressin: s.vasopressin, testosterone: s.testosterone, estrogen: s.estrogen },
        aggression: s.aggression,
        freeze: s.freeze,
        cycle: { on: s.cycleOn, day: s.cycleDay, phase: s.cyclePhase || null },
        stimulant: s.stimulant,
      }
    },
    snapshot: () => ({ ...s }),
    restore(o) { if (o) s = { ...fresh(), ...o } },
    health: () => ({ ok: true, degraded: false, frame: s.frame }),
  }
}
