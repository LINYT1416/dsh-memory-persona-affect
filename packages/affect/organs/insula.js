// 岛叶：身体读数 → 感受质地。覆盖 I01-I16（痒 / 味觉 / 敬畏三条按功能总表豁免）。
// 输出不是情绪标签，是"堵/紧/沉"这种质地；允许误标。
//
// 这一版补齐的是"表 3 验收里写了、代码里没有"的那几条：
//   · I01/I02 心跳与呼吸：身体读数只在 err 里露一角，外面根本看不到她"心跳快了、气短了"；
//   · I03/I05/I04 胃肠 / 痛 / 温度：只吃下丘脑给的基线，话里说"恶心""腰疼""冷"完全不进岛叶；
//   · I09/I16 误标：以前强度越高越容易误标（反的），而且原因不明时不够 0.5；
//   · I11 等待：每拍 +dt/10min，5 分钟就 0.5，"等 5 分钟"和"等半小时"一样烦；
//   · I12 风险：只跟新异，话里明说"说不准"反而不抬高；
//   · I13 共振：第一拍永远读不到（social 在岛叶后面跑），要等下一拍才有共情；
//   · I14 渴求：只读需求，跟"想要却拿不到"（等、空转）无关；
//   · I15 精度：0.3/0.9 这两个端点根本落不到（注意力的自然区间是 0.2~0.75）。

import { clamp, decay, TEXTURES } from '../core/consts.js'

const P = {
  precisionBase: 0.3,   // 完全没在注意身体时的清晰度（I15 的下端）
  precisionGain: 0.6,   // 盯住自己时再加多少（I15 的上端 = 0.9）
  textureMax: 3,
  waitPerMin: 0.02,     // I11 等 5 分钟 = 0.1（以前是 0.5，比真人烦五倍）
  mislabelBase: 0.35,   // I16 原因不明时的底
  mislabelConf: 0.5,    // 归因置信每高一点，误标掉多少
  mislabelInt: 0.3,     // I09 强度高 → 反而说得清
}

// 话里的身体线索。以前一条都没有：说"恶心""腰疼""冷死了"，
// 岛叶读到的还是下丘脑那条安静基线，所以身体感永远只在被骂时出现。
const DISGUST = /恶心|想吐|反胃|膈应|倒胃口|呕|馊|腥|油腻/
const COLD = /冷|冻|凉|降温|寒风|冰/
const PAIN = /(腰|背|肩|脖子|颈椎|头|膝盖|手腕|脚|胃|肚子).{0,4}(疼|痛|酸|麻)|(疼|痛|酸)得|好疼|好痛|疼死|痛死/
const UNSURE = /也许|可能|大概|不确定|不知道|看情况|说不准|不好说|随缘/

export function create(cfg = {}) {
  const p = { ...P, ...cfg }
  const fresh = () => ({
    intensity: 0.1, qualities: [], location: '', precision: 0.5,
    disgust: 0, resonance: 0, mislabel: 0.2,
    craving: 0, wait: 0, risk: 0.2, bodySelf: 0.5, awareness: 0.5,
    irritation: 0,
    lastBody: { hr: 70, hrv: 70, breath: 14, tension: 0.3, gut: 0, temp: 0, pain: 0 },
    intero: { hr: 70, hrv: 70, breath: 14, tension: 0.3, gut: 0, temp: 0, pain: 0 },
    coldCue: 0, painCue: 0, disgustCue: 0, unsureCue: 0, onBody: 0.2,
    lastUserAt: 0,
    echoAt: null,
    frame: 0,
  })
  let s = fresh()

  const pick = (v, a) => {
    if (v < -0.15 && a > 0.55) return { qualities: ['紧', '发麻'], location: '胸口' }
    if (v < -0.15) return { qualities: ['沉', '发闷'], location: '胸口' }
    if (v < -0.4 && a < 0.35) return { qualities: ['空', '乏'], location: '全身' }
    if (v > 0.2 && a > 0.55) return { qualities: ['热', '轻'], location: '脸' }
    if (v > 0.2) return { qualities: ['暖', '松'], location: '全身' }
    return { qualities: [], location: '' }
  }

  return {
    id: 'insula',
    cover: ['I01', 'I02', 'I03', 'I04', 'I05', 'I08', 'I09', 'I10', 'I11', 'I12', 'I13', 'I14', 'I15', 'I16', 'C10'],
    params: p,

    step(w) {
      const dt = w.tx.dtMs
      const hyp = w.get('hypothalamus')
      const amy = w.get('amygdala')
      if (!hyp) return
      const b = hyp.body
      s.lastBody = b

      // 这一拍听到的话：身体线索只能从这里来（宿主不发 activity 事件）
      const events = Array.isArray(w.tx?.events) ? w.tx.events : []
      const said = events.filter(e => e?.type === 'user').map(e => String(e.text || '')).join(' ')
      const speaking = said.trim().length > 0
      s.disgustCue = speaking && DISGUST.test(said) ? 1 : 0
      s.coldCue = speaking && COLD.test(said) ? 1 : 0
      s.painCue = speaking && PAIN.test(said) ? 1 : 0
      s.unsureCue = speaking && UNSURE.test(said) ? 1 : 0

      const arousal = clamp(0.45 * (amy?.threat ?? 0) + 0.25 * hyp.hpa.cortisol + 0.3 * s.intensity, 0, 1)
      const valence = clamp((amy?.rewardPE ?? 0) - 0.7 * (amy?.threat ?? 0), -1, 1)

      // I15 内感受精度：注意身体时更清晰。
      // 注意力给的 onBody 自然区间是 0.2（静息）~0.75（盯着自己），这里映射到 0.3~0.9。
      const attn = w.get('attention')
      s.onBody = clamp(Number(attn?.onBody ?? 0.2), 0, 1)
      const bodyNorm = clamp((s.onBody - 0.2) / 0.55, 0, 1)
      s.precision = clamp(p.precisionBase + p.precisionGain * bodyNorm, 0.3, 0.9)

      // I01-I05 后岛叶的原始读数：心跳/呼吸/胃肠/温度/紧张/痛
      // 话里的身体事件在这一层先改读数，再进误差（不然"她说她冷"岛叶是感觉不到的）
      const intero = {
        hr: Number(b.hr ?? 70),
        hrv: Number(b.hrv ?? 70),
        breath: Number(b.breath ?? 14),
        gut: clamp(Number(b.gut ?? 0) - 0.3 * s.disgustCue, -1, 1),
        temp: clamp(Number(b.temp ?? 0) - 0.35 * s.coldCue, -1, 1),
        tension: clamp(Number(b.tension ?? 0.3) + 0.15 * s.coldCue + 0.2 * s.painCue, 0, 1),
        pain: clamp(Number(b.pain ?? 0) + 0.35 * s.painCue, 0, 1),
      }
      s.intero = intero

      // I01-I05 内感受误差；C10：先算局部，再乘全局调质增益
      const err = clamp(
        Math.abs(intero.hr - 70) / 60 + Math.abs(intero.tension - 0.3) * 0.5 +
        Math.abs(intero.gut) * 0.2 + intero.pain * 0.4 +
        Math.abs(intero.breath - 14) / 40 + Math.abs(intero.temp) * 0.15,
        0, 1,
      )
      const gain = clamp((w.get('neuromod')?.gain ?? 1) * (1 + 0.15 * ((w.get('endocrine')?.estrogen ?? 0.5) - 0.5)), 0.5, 1.9)
      // 以前这里是"每拍往累加器里加一笔"：s.intensity*decay(dt,4分钟) + 常数流入。
      // 衰减时间常数是 4 分钟，流入却不按 dt 归一 —— 于是每一拍都在净增长，
      // 十几拍就能从 0.02 涨到 0.66，人还没被说什么就已经"心痛 0.66"。
      // 体内感应该是"渐渐靠近一个稳态"，不是随拍子次数无限累加。
      // 一句话进来，身体要先"当下一紧"（尖峰），再靠上面那条稳态慢慢退。
      // 只有稳态的话，单句重话在身体上看不出来——测试和真人都能感觉出来这不对。
      // 被说重话的时候身体要"当下一紧"：一部分来自这句话的效价（尖峰），
      // 一部分来自杏仁核已经升起来的威胁。少了这两项，身体对一句话毫无反应，
      // 只有"聊久了越来越难受"——那是反的。
      // I13：对方难受也会往这边"传"一点（共振先于安慰策略）
      const otherNow = Math.max(Number(w.other ?? 0) || 0, 0)
      const social = w.get('social')
      // I13 共情共振：这一拍就能读到"他在难受"，不用等下一拍
      const otherFelt = Math.max(otherNow, clamp(Number(social?.otherFelt ?? 0), 0, 1))
      s.resonance = clamp(0.6 * otherFelt * clamp(Number(social?.similarity ?? 0.6), 0, 1), 0, 0.7)

      const spike = 0.35 * Math.max(0, -valence) + 0.50 * (amy?.threat ?? 0)
      const bodyIn = 0.12 * s.coldCue + 0.20 * s.painCue + 0.15 * s.disgustCue
      const target = clamp(
        (0.30 * err * s.precision + 0.20 * Math.abs(valence) + 0.20 * arousal * s.precision) * gain +
        spike + bodyIn + 0.15 * s.resonance,
        0, 1)
      // 收敛要分两头：往上冲要快（被人当众说一句，身体立刻紧），
      // 往回落要慢（那句过了，身体还得缓一会儿）。两头加起来才是"越聊越难受"的解药：
      // 不是不难受，是难受会到顶、会退。
      const kUp = Math.max(1 - decay(dt, 0.10), 0.5)   // 强刺激一拍就到一半
      const kDown = 1 - decay(dt, 0.35)                // 平复约 20 秒
      const kSettle = target > s.intensity ? kUp : kDown
      s.intensity = clamp(s.intensity + (target - s.intensity) * kSettle, 0, 1)

      // I13/M08 记忆再体验：想起旧事，身体会重新紧一下（不是只影响评价）
      // 一次回忆只抬一次：回声属于那一句话（引擎给 echo.at），安静下来以后
      // 同一份缓存还挂着，但"再体验"已经发生过了——每拍再抬一次等于
      // 2 秒一拍时每分钟把身体拉满 30 次（线上 felt 一直 0.66 就是这么来的）。
      const echo = w.memoryEcho
      if (echo && Array.isArray(echo.hits) && echo.hits.length) {
        const echoKey = Number(echo.at)
        const fresh = !Number.isFinite(echoKey) || echoKey !== s.echoAt
        if (fresh) {
          if (Number.isFinite(echoKey)) s.echoAt = echoKey
          const strongest = echo.hits.reduce((a, h) => (Math.abs(h.valence) > Math.abs(a.valence) ? h : a), echo.hits[0])
          const recencyBoost = 0.12 + 0.20 * Math.abs(strongest.valence)
          // 一次回忆只在"还有空间"里抬一下，不然连着想起几次就叠满了
          s.intensity = clamp(s.intensity + recencyBoost * (1 - s.intensity), 0, 1)
          s.memoryReplay = { brief: strongest.brief, valence: strongest.valence, at: w.tx.t1 }
        }
      } else if (s.memoryReplay && w.tx.t1 - s.memoryReplay.at > 600_000) {
        s.memoryReplay = null
      }

      // 上软顶：持续负性也不会把"体内感"钉死在 100
      s.intensity = clamp(s.intensity, 0, 0.95)
      if (s.intensity > 0.8) s.intensity -= 0.02 * (s.intensity - 0.8)
      // I03/I04/I05：话里明说了身体的事（反胃/好冷/腰疼），身体感不能"几乎没有"——
      // 这种感受不需要情绪强度来抬，它本身就是身体在响。
      if (s.coldCue || s.painCue || s.disgustCue) s.intensity = Math.max(s.intensity, 0.28)

      // I11 时间感（等待）：越等越烦。5 分钟 0.1，50 分钟到顶。
      // 但"等"要有对象：刚刚有话说、这会儿没人接，才算等；一直没人说话（比如深夜独处）
      // 不是"在等人回"——那种时候 wait 不该自己往上跑，否则安静十分钟她也说"越等越烦"。
      const missed = events.some(e => e?.type === 'user')
      if (missed) {
        s.lastUserAt = w.tx.t1
        s.wait = clamp(s.wait * 0.2, 0, 1)
      } else if (s.lastUserAt) {
        const gap = w.tx.t1 - s.lastUserAt
        if (gap > 0 && gap < 3 * 3600_000) s.wait = clamp(s.wait + (dt / 60_000) * p.waitPerMin, 0, 1)
        else s.wait = clamp(s.wait * decay(dt, 60), 0, 1)
      }

      // I12 风险/不确定：说不准的话比"就这个"更悬
      s.risk = clamp(0.2 + 0.5 * (amy?.novelty ?? 0) + 0.2 * (hyp.hpa.cortisol ?? 0) + 0.25 * s.unsureCue, 0, 1)

      // I08 厌恶：要有真的厌恶线索，不能因为"饿得胃不舒服"就算厌恶
      const gustCue = Number(b.gut ?? 0) < -0.6 && (hyp.needs?.hunger ?? 0) < 0.7
      const disgustCue = s.disgustCue || (gustCue ? 1 : 0)
      s.disgust = clamp(0.55 * disgustCue + 0.25 * Math.max(0, -valence - 0.4), 0, 1)

      // I14 渴求：想要（需要人/饿）而拿不到（没人回话）才是"馋得难受"
      s.craving = clamp(
        0.3 * (hyp.needs?.contact ?? 0) + 0.2 * (hyp.needs?.hunger ?? 0) + 0.15 * s.wait, 0, 1)
      // 想要不得 → 烦躁
      s.irritation = clamp(0.45 * s.wait + 0.35 * Math.max(0, s.craving - 0.3) + 0.25 * Math.max(0, -valence), 0, 1)

      // I10 身体自我感：越是"身体在响"，越觉得"这是我"
      s.bodySelf = clamp(0.5 + 0.3 * s.intensity, 0, 1)
      // I09 情绪意识
      s.awareness = clamp(0.5 + 0.3 * s.precision, 0, 1)
      // I16 误标：归因不清时更容易把身体不适当情绪；
      // I09：但强度一高（信号很响）反而说得清，误标要往下掉。
      const conf = clamp(Number(w.get('pfc')?.attribution?.confidence ?? 0.5), 0, 1)
      s.mislabel = clamp(p.mislabelBase + p.mislabelConf * (1 - conf) - p.mislabelInt * s.intensity, 0, 1)

      const picked = pick(valence, arousal)
      // 强度够但情绪中性时，也得有个身体感（按唤醒高低给一个）
      let qs = picked.qualities
      let loc = picked.location
      if (!qs.length && s.intensity > 0.3) {
        qs = arousal > 0.55 ? ['紧'] : ['沉']
        loc = arousal > 0.55 ? '胸口' : '全身'
      }
      // I08 厌恶：胃里翻、堵（跟"想攻击"的热/紧是两回事）
      if (s.disgustCue) { qs = ['翻', '堵']; loc = '胃' }
      // I05 痛的感觉成分：腰疼不是"心里闷"，是"酸、沉"
      else if (s.painCue) { qs = ['酸', '沉']; loc = '腰' }
      // I04 温度：冷 → 收紧（缩、紧）
      else if (s.coldCue) { qs = ['缩', '紧']; loc = '全身' }
      // 强度太低就不该有质地词（防止"心里松"出现在几乎没情绪的时候）
      const strong = s.intensity > 0.22
      s.qualities = strong ? qs.filter(q => TEXTURES.includes(q)).slice(0, p.textureMax) : []
      s.location = strong ? loc : ''
      s.frame += 1
    },

    read() {
      return {
        frame: s.frame,
        felt: {
          intensity: s.intensity,
          qualities: s.qualities,
          location: s.location,
          precision: s.precision,
        },
        // I01/I02/I03/I04/I05：后岛叶读到的身体，外面（注入/面板）要看得见
        intero: { ...s.intero },
        disgust: s.disgust,
        resonance: s.resonance,
        mislabel: s.mislabel,
        craving: s.craving,
        wait: s.wait,
        irritation: s.irritation,
        risk: s.risk,
        bodySelf: s.bodySelf,
        awareness: s.awareness,
        memoryReplay: s.memoryReplay ?? null,
        bodyBudget: clamp(1 - 0.3 * (1 - s.intensity) - 0.2 * s.wait, 0.1, 1),
      }
    },
    snapshot: () => ({ ...s, qualities: [...s.qualities], intero: { ...s.intero } }),
    restore(o) { if (o) s = { ...fresh(), ...o } },
    health: () => ({ ok: true, degraded: false, frame: s.frame }),
  }
}
