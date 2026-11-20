// 病感行为：炎症 → 低落 / 疲劳 / 退缩 / 痛觉敏化。覆盖 F01-F04。
//
// 以前这里只有 inflammation 是"状态"：fatigue / withdraw / hyperalgesia 都是它的倍数影子，
// 而 inflammation 只认 type==='sick' 的外部事件——真实对话里从来没人发这种事件，
// 于是四个字段恒为 0，fuse/inject 里那几行病感分支永远进不去。
//
// 现在：① 从这一拍的话里认出"她自己在生病"；② 四个状态各自一阶滞后，
// 上升快、回落慢，而且各有各的回落时间常数（F02 的验收就是"乏力比炎症拖得久"）。

import { clamp } from '../core/consts.js'

// ── 时间常数（分钟）──
// 上升是几分钟量级：发烧是当场的事，不该半小时后才"开始难受"。
// 回落各走各的：炎症四十来分钟就退，乏力和痛敏要比它拖得久得多。
const T = {
  sev: 35,                                        // "我这会儿是个病人"这件事本身的遗忘速度
  inflUp: 0.8, inflDown: 25,                      // F01 炎症（急性：退得快）
  fatUp: 1.2, fatDown: 200,                       // F02 疲劳（慢慢上、慢慢退，半衰 ≈ 2.3 小时）
  wdUp: 1.0, wdDown: 100,                         // F03 退缩（不想聊）
  haUp: 1.0, haDown: 140,                         // F04 痛觉敏化
}

// 病感线索：整词级匹配。不用单字"病/疼"乱撞——"毛病""心疼"不是生病。
const CUES = [
  { w: 0.50, rx: /发烧|发热|高烧|低烧|烧到|烧得|体温高/ },
  { w: 0.50, rx: /感冒|流感|新冠|阳了|肺炎|发炎|炎症|感染|肠胃炎|胃炎|咽喉炎|支气管炎|扁桃体/ },
  { w: 0.46, rx: /咳嗽|嗓子疼|喉咙疼|嗓子发炎|喉咙肿|哑了/ },
  { w: 0.50, rx: /头疼|头痛|头晕|浑身疼|全身疼|身上疼|肌肉酸|酸痛|骨头疼/ },
  { w: 0.44, rx: /拉肚子|腹泻|呕吐|想吐|反胃/ },
  { w: 0.36, rx: /打喷嚏|流鼻涕|鼻塞|发冷|打冷战/ },
  { w: 0.40, rx: /不舒服|难受得很|难受得要命|难受得厉害/, soft: true },
  { w: 0.38, rx: /没劲|没力气|乏力|浑身无力|使不上劲|虚脱|撑不住/ },
  { w: 0.40, rx: /生病|病了|病倒|卧病|请病假/ },
  { w: 0.36, rx: /累倒|累趴|累垮|起不来床|躺着不想动/ },
]
// 别人病了不是她病了："我妈发烧了" 该让她去照顾，不是让她也倒下。
const OTHER_SICK = /(他|她|他们|我妈|我爸|我家|朋友|同事|同学|室友|对象|孩子|宝宝|家里人)[^，,。;；!！?？]{0,6}(发烧|发热|感冒|生病|病了|咳嗽|头疼|不舒服|住院|打针|拉肚子)/
const SELF_SICK = /(?:我自己|我(?!们|妈|爸|家|的|女|男|俩|身边))[^，,。;；!！?？]{0,6}(发烧|发热|感冒|生病|病了|咳|头疼|头痛|不舒服|没劲|难受|疼|虚|烧|晕)/
// "你这话让我不舒服" 是情绪，不是身体。
const WORDS_NOT_BODY = /(这话|这句话|那句|听起来|看着|心里|气氛|感觉这)/

/** 这一句里有多"病"（0 = 没病）。导出给测试与探针用，不改变器官接口。 */
export function cueOf(text) {
  const t = String(text || '')
  if (!t) return 0
  if (OTHER_SICK.test(t) && !SELF_SICK.test(t)) return 0
  const bodyOnly = /发烧|发热|感冒|头疼|头痛|嗓子|喉咙|咳嗽|鼻塞|拉肚子|恶心|呕吐|生病|病倒|病假/.test(t)
  const wordsOnly = WORDS_NOT_BODY.test(t) && !bodyOnly
  let hits = 0
  let strength = 0
  for (const c of CUES) {
    if (c.soft && wordsOnly) continue
    if (!c.rx.test(t)) continue
    hits += 1
    strength = Math.max(strength, c.w)
  }
  if (!hits) return 0
  // 一处症状是"有点不对"，三处就是"真的病了"；单条弱线索停在 0.42 上下，不会当成重病。
  return clamp(strength + 0.15 * (hits - 1), 0, 0.95)
}

// 一阶滞后：上升用 up，回落用 down。上升/回落不对称，是这个模块唯一的花样。
const toward = (cur, target, up, down, dtMin) => {
  const tau = target > cur ? up : down
  const k = 1 - Math.exp(-dtMin / Math.max(0.001, tau))
  return cur + (target - cur) * k
}

export function create() {
  const fresh = () => ({ inflammation: 0, fatigue: 0, withdraw: 0, hyperalgesia: 0, severity: 0, frame: 0 })
  let s = fresh()

  return {
    id: 'sickness',
    cover: ['F01', 'F02', 'F03', 'F04'],
    step(w) {
      const dtMin = clamp((w.tx?.dtMs ?? 0) / 60_000, 0, 24 * 60)

      // ── 1. 认这一拍说了什么 ──
      // 显式 sick 事件（外部触发）和老路径兼容；对话里的话按线索打分。
      let cue = 0
      for (const ev of w.tx?.events ?? []) {
        if (!ev) continue
        if (ev.type === 'sick') cue = Math.max(cue, 0.8)
        else if (ev.type === 'user') cue = Math.max(cue, cueOf(ev.text))
      }
      if (cue > 0) s.severity = clamp(Math.max(s.severity, cue), 0, 1)
      else s.severity *= Math.exp(-dtMin / T.sev)

      // ── 2. 四个状态各自一阶滞后 ──
      // 目标值由 severity 给：炎症最重（急性），乏力七成半、退缩七成半、痛敏九成。
      // 谁也不做炎症的倍数影子——各自有各自的上升/回落时间常数。
      const sev = s.severity
      s.inflammation = clamp(toward(s.inflammation, 0.95 * sev, T.inflUp, T.inflDown, dtMin), 0, 1)  // F01
      s.fatigue = clamp(toward(s.fatigue, 0.75 * sev, T.fatUp, T.fatDown, dtMin), 0, 1)             // F02
      s.withdraw = clamp(toward(s.withdraw, 0.75 * sev, T.wdUp, T.wdDown, dtMin), 0, 1)              // F03
      s.hyperalgesia = clamp(toward(s.hyperalgesia, 0.90 * sev, T.haUp, T.haDown, dtMin), 0, 1)      // F04
      s.frame += 1
    },
    // 只读现有五个字段：多露一个没人消费的键，字段契约会红。
    read() {
      return { frame: s.frame, inflammation: s.inflammation, fatigue: s.fatigue, withdraw: s.withdraw, hyperalgesia: s.hyperalgesia }
    },
    snapshot: () => ({ ...s }),
    restore(o) { if (o) s = { ...fresh(), ...o } },
    health: () => ({ ok: true, degraded: false, frame: s.frame }),
  }
}
