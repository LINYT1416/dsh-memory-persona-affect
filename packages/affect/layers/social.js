// 社会层：自我/他人、心智化、共情、排斥、依恋、账本、地位、传染、共情疲劳、态度、信任。
// 覆盖 S01-S12。
//
// 这一版修的是"字段看起来在、其实没人写"：
//   · comfort 原来只是 trust 的静态函数（(trust-0.5)*2 还被 0 截断），
//     trust 在 0.5 以下时它对"被冷落"完全无感，线上就是一个 0/0.2 的阶跃。
//   · similarity / relationship 从来没被赋过值（一个是 0.6，一个是 'close'，到死不动）。
//   · empathyFatigue 等的是一个引擎永远不会发出的 other_distress 事件，所以恒 0。
//   · ledger 只在 threat>0.6 时记一笔，被晾着这种最该记账的事根本不记；
//     而 read() 里也没把 ledger 交出去，外面看就是"没有这个字段"。
//   · attachment 用 trust 的死区间 [0.4,0.7] 判型，初始 trust 正好 0.6，
//     于是第一拍就把 'secure' 判成 'avoidant' —— 跟输入完全无关。
//
// 现在的分工：
//   每个量有自己的充/放时间常数，靠"这一句是什么话"驱动，不用按拍数累加
//   （rate-audit 就是抓这个的：安静两分钟里任何字段都不许跳 >0.02）。

import { clamp, decay } from '../core/consts.js'

// 对方在难受（engine 的 w.other 只认几种说法，这里放宽一点，别漏）
const HURT = /难受|崩溃|哭|失眠|压力大|烦死|好累|撑不住|委屈|低落|想哭|不想活|熬不住|心累/
// 明确的好意（被夸、被谢、被惦记）
const WARM = /谢谢|喜欢你|爱你|真好|开心|抱|亲|陪我|懂我|靠谱|辛苦|想你|乖/
// 道歉 —— 账本该清
const SORRY = /对不起|抱歉|我错|是我不好|别生气|不该这么说|说重了|刚才是我/
// 直接冲她来的难听话
const INSULT = /垃圾|废物|蠢|闭嘴|没用|离谱|白痴|滚|重写|搞砸|行不行|做的什么|干的什么/
const TECH_SAFE = /垃圾回收|垃圾分类|垃圾箱|垃圾代码|缓存|内存/
// 冷落：整句就是这几个字（跟 consts 的 COLD_ONLY 对齐）
const COLD_ONLY = /^(哦|嗯|随便|都行|算了|行吧|知道了|随你)[。.!！~～\s]*$/
// S02：敷衍的接法——"都行/你定/随便"，不是冷，是没把这事当回事。
const PERFUNCTORY = /随便|都行|你定|你看着办|无所谓|嗯嗯|哦哦|呵呵|懒得|算了吧/
// S01：这句在说她自己（"我今天好难受"）还是别人（"他今天好难受"）。
const SELF_SUBJECT = /(?:^|[，,。；;])\s*我[^，,。；;]{0,10}(?:难受|崩溃|哭|失眠|压力大|好累|撑不住|委屈|低落|想哭|心累)/
const OTHER_SUBJECT = /(?:他|她|他们|人家|朋友|同事|我妈|我爸|你)/

export function create(cfg = {}) {
  const P = {
    tauPain: 20,        // 被晾的疼：20 分钟量级才散
    tauComfort: 3,      // 被安抚到：快起快落
    tauFatigue: 180,    // 共情疲劳：攒着，三小时才散
    tauOther: 6,        // 对方状态的余温
    tauLike: 10,        // 相似度（像不像我）
    ledgerMax: 8,       // 账本最多留几条，不许无限长
  }
  const p = { ...P, ...cfg }

  const fresh = () => ({
    selfOther: 0.7, mindRead: 0.5, affectiveEmpathy: 0.5, cognitiveEmpathy: 0.5,
    socialPain: 0, attachment: 'secure', ledger: [], status: 0.5,
    contagionOut: 0, empathyFatigue: 0,
    attitude: {}, trust: 0.6,
    otherFelt: 0, similarity: 0.6, comfort: 0,
    relationship: 'close', frame: 0,
    distressStreak: 0, warmth: 0,
  })
  let s = fresh()

  // 时间步：把"目标值 → 当前值"按 dt 收敛，绝不按拍数走
  const toward = (cur, target, dt, tau) => cur + (target - cur) * (1 - Math.exp(-(dt / 60_000) / Math.max(0.1, tau)))

  return {
    id: 'social',
    cover: ['S01', 'S02', 'S03', 'S04', 'S05', 'S06', 'S07', 'S08', 'S09', 'S10', 'S11', 'S12'],
    step(w) {
      const dt = w.tx.dtMs
      const amy = w.get('amygdala')
      const ins = w.get('insula')
      const pfc = w.get('pfc')
      const ctx = w.context || {}
      const threat = clamp(amy?.threat ?? 0, 0, 1)
      const events = Array.isArray(w.tx.events) ? w.tx.events : []
      const said = events.filter(e => e.type === 'user').map(e => String(e.text || '')).join(' ')
      const talking = said.trim().length > 0

      // 这一句是什么话：冷 / 暖 / 骂 / 道歉 / 对方难受
      const cold = (amy?.cue === '冷') || (talking && COLD_ONLY.test(said.trim()))
      const insult = talking && !TECH_SAFE.test(said) && INSULT.test(said)
      const sorry = amy?.kind === 'apology' || (talking && SORRY.test(said))
      const warm = talking && !cold && !insult && (Number(ctx.praise ?? 0) > 0 || WARM.test(said))
      // S01 分清谁难受：说自己的难受，不该被记成"他难受"。
      const selfHurt = talking && SELF_SUBJECT.test(said)
      const otherHurt = talking && OTHER_SUBJECT.test(said) && HURT.test(said)
      const hurt = otherHurt || (!selfHurt && (clamp(Number(w.other ?? 0), 0, 1) > 0 || (talking && HURT.test(said))))
      const perf = talking && !insult && !warm && PERFUNCTORY.test(said)
      // 一句好话里夹着刺（"谢谢啊，又搞砸了"）：按刺算，不按夸算
      const sting = talking && /又|还是|到底|说了几遍|怎么还|服了|无语|呵呵/.test(said)

      // ── S01 自我/他人：他的事占上风时，"我"退到后面 ──
      s.selfOther = clamp(toward(s.selfOther, hurt ? 0.35 : 0.7, dt, 8), 0, 1)
      // ── S02 心智化：带宽高才猜得准；对方敷衍时，"他没那么在意"这个判断更清楚 ──
      s.mindRead = clamp(0.25 + 0.45 * (pfc?.bandwidth ?? 0.6) + (perf ? 0.28 : 0), 0, 1)

      // ── S05 社会排斥痛：被晾着才是疼 ──
      // 冷落给最大一笔；被骂也给，但那是"被扎"不是"被丢下"，量小一档
      const painIn = (cold ? 0.26 : 0) + (insult ? 0.10 : 0)
      const painOut = (warm ? 0.18 : 0) + (talking && !cold && !insult ? 0.06 : 0) + (sorry ? 0.10 : 0)
      s.socialPain = clamp(s.socialPain * decay(dt, p.tauPain) + painIn - painOut, 0, 1)

      // ── S07 账本：没清的事 ──
      // 被晾着、被扎一下，都是"这笔还没完"；道歉（或明确的好意）才清掉
      const open = s.ledger.filter(l => !l.cleared)
      const pushLedger = (reason) => {
        if (open.length && open.some(l => l.reason === reason)) return
        s.ledger.push({ at: w.tx.t1, reason, cleared: false })
        if (s.ledger.length > p.ledgerMax) s.ledger = s.ledger.slice(-p.ledgerMax)
      }
      if (cold) pushLedger('被晾着，没回音')
      else if (insult) pushLedger('那句话说重了')
      if (sorry || (warm && s.socialPain < 0.25)) for (const l of s.ledger) l.cleared = true
      // 疼得久了也自己淡掉（不然一笔账挂一整天）
      if (s.socialPain < 0.05) for (const l of s.ledger) if (!l.cleared && w.tx.t1 - Number(l.at || 0) > 3 * 3600_000) l.cleared = true
      const ledgerOpen = s.ledger.filter(l => !l.cleared).length

      // ── S12 信任：一句一句地攒，也一句一句地掉 ──
      // 以前一次冷落能按"threat>0.7 每分钟 -0.1"掉 0.1，太糙；改成按这一句的性质给
      const trustIn = (warm ? 0.03 : 0) + (sorry ? 0.05 : 0) + (talking && !cold && !insult && !hurt ? 0.004 : 0)
      const trustOut = (insult ? 0.05 : 0) + (cold ? 0.035 : 0) + (perf ? 0.02 : 0)
      s.trust = clamp(s.trust + trustIn - trustOut, 0, 0.9)
      // 长期那点漂移还在，但按小时走；态度好时慢慢长，天花板 0.85
      s.trust = clamp(s.trust + 0.36 * (dt / 3600_000) * (s.attitude['他'] ?? 0), 0, 0.85)

      // ── 对方状态（供岛叶共振）──
      // 起得快、落得慢：他难受这件事会挂一会儿，不是说完就没了。
      // 用 max 不用加法：连续几轮难受不该把它叠到 1（那等于每一句都"最难受"）
      const hurtNow = hurt ? Math.max(0.45, clamp(Number(w.other ?? 0), 0, 1)) : 0
      s.otherFelt = clamp(Math.max(s.otherFelt * decay(dt, p.tauOther), hurtNow), 0, 1)

      // ── S10 共情疲劳：安慰人是要耗的，连着安慰耗得更快 ──
      s.distressStreak = hurt ? Math.min(6, s.distressStreak + 1) : Math.max(0, s.distressStreak - 1)
      // 以前"没在安慰"时每拍 -0.02：一分钟一拍等于一小时掉 1.2，比 tau=180min 的衰减快得多，
      // 于是连着安慰也攒不起来。现在只在安慰时加一小笔，回血交给 decay。
      const fatigueIn = hurt ? 0.030 + 0.012 * Math.min(4, s.distressStreak - 1) : 0
      s.empathyFatigue = clamp(s.empathyFatigue * decay(dt, p.tauFatigue) + fatigueIn, 0, 1)

      // ── S03/S04 共情 ──
      // 岛叶共振是上一帧的（ORDER_B 里 insula 先跑），这里只负责把"他难受"接进去
      const resonance = clamp(ins?.resonance ?? 0, 0, 1)
      const fatigueDamp = 1 - 0.45 * s.empathyFatigue
      s.affectiveEmpathy = clamp(
        0.18 + 0.45 * resonance + 0.2 * s.trust + 0.35 * s.otherFelt * fatigueDamp, 0, 1,
      )
      // 认知共情：猜得准 = 带宽 + 想起来过类似的事 + 他确实在给线索；心里堵着就猜不动
      const echoHits = Array.isArray(w.memoryEcho?.hits) ? w.memoryEcho.hits.length : 0
      s.cognitiveEmpathy = clamp(
        0.28 + 0.35 * s.mindRead + 0.2 * Math.min(1, echoHits / 3) + (hurt ? 0.15 : 0) - 0.2 * s.socialPain, 0, 1,
      )

      // ── S06 依恋：先看有没有被晾/被扎，再看整体安不安全；不满足条件就不动（防抖） ──
      // 安全分：信任打底，被安抚加分，被晾着扣分
      const safe = s.trust + 0.5 * s.comfort - 0.55 * s.socialPain
      if (s.socialPain > 0.45) s.attachment = 'anxious'
      else if (ledgerOpen > 0 && safe < 0.42) s.attachment = 'avoidant'
      else if (safe >= 0.58) s.attachment = 'secure'
      // 0.42~0.58 之间保持原样：一句"嗯"不该让人格整个换掉

      // ── 被安抚到什么程度：快起快落，被晾着立刻塌 ──
      s.warmth = clamp(toward(s.warmth, warm && !sting ? 1 : 0, dt, 2), 0, 1)
      const comfortTarget = clamp(0.05 + 0.30 * s.trust + 0.30 * s.warmth - 0.65 * s.socialPain, 0, 1)
      s.comfort = clamp(toward(s.comfort, comfortTarget, dt, p.tauComfort) - (cold ? 0.12 : 0) + (warm && !sting ? 0.06 : 0), 0, 1)

      // ── 相似度：他这点跟我像不像（记忆里有共鸣、话头对得上、在软化）──
      const pair = w.pair
      const likeTarget = clamp(
        0.55 + (echoHits > 0 ? 0.15 : 0) + (pair?.softening ? 0.10 : 0) + (Number(ctx.addressed ?? 0) ? 0.08 : 0)
        + (warm ? 0.06 : 0) - (cold ? 0.15 : 0) - (insult ? 0.12 : 0),
        0, 1,
      )
      s.similarity = clamp(toward(s.similarity, likeTarget, dt, p.tauLike), 0, 1)

      // ── S08 地位：被谢/被夸抬一点，被骂掉一点 ──
      s.status = clamp(
        s.status + (warm ? 0.012 : 0) - (insult ? 0.02 : 0) - (cold ? 0.006 : 0)
        + (0.01 - (threat > 0.5 ? 0.02 : 0)) * (dt / 3600_000), 0, 1,
      )

      // ── S09 情绪传染（她→他）──
      s.contagionOut = clamp(
        0.8 * (ins?.felt.intensity ?? 0) + 0.3 * (w.mood ?? 0) * -1 + 0.15 * s.otherFelt, 0, 1,
      )

      // ── S11 长期态度：攒得很慢，也散得很慢 ──
      const who = '他'
      const dAtt = (warm ? 0.03 : 0) - (insult ? 0.05 : 0) - (cold ? 0.02 : 0) + (sorry ? 0.02 : 0) + 0.004 * (dt / 60_000)
      s.attitude[who] = clamp((s.attitude[who] ?? 0) + dAtt, -1, 1)

      // ── 关系：close / acquaintance / stranger（带死区，别一句话就翻脸）──
      // 有账没清 + 分低 = stranger；分高 = close；中间不满足条件就保持原样
      const relScore = s.trust + 0.5 * s.comfort - 0.55 * s.socialPain
      if (ledgerOpen > 0 && relScore < 0.5) s.relationship = 'stranger'
      else if (relScore >= 0.62) s.relationship = 'close'
      else if (relScore < 0.5) s.relationship = 'acquaintance'

      s.frame += 1
    },
    read() {
      return {
        frame: s.frame,
        selfOther: s.selfOther, mindRead: s.mindRead,
        affectiveEmpathy: s.affectiveEmpathy, cognitiveEmpathy: s.cognitiveEmpathy,
        socialPain: s.socialPain, attachment: s.attachment, status: s.status,
        contagionOut: s.contagionOut, empathyFatigue: s.empathyFatigue,
        attitude: { ...s.attitude }, trust: s.trust,
        otherFelt: s.otherFelt, similarity: s.similarity, comfort: s.comfort,
        relationship: s.relationship,
        // 账本交给外面看：以前只有 ledgerOpen，外面读 organs.social.ledger 永远是 undefined
        ledger: s.ledger.map(l => ({ at: l.at, reason: l.reason, cleared: l.cleared })),
        ledgerOpen: s.ledger.filter(l => !l.cleared).length,
      }
    },
    snapshot: () => ({ ...s, ledger: s.ledger.map(l => ({ ...l })), attitude: { ...s.attitude } }),
    restore(o) { if (o) s = { ...fresh(), ...o } },
    health: () => ({ ok: true, degraded: false, frame: s.frame }),
  }
}
