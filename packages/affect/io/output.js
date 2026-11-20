// 输出通道：措辞 / 句长 / 标点 / 延迟 / 表情包 / 语音 / 泄漏 / 释放 / 求安慰 / 自报误差。
// 覆盖 O04-O13。
//
// 这一版修的是"通道只在数数，不真的决定怎么说话"：
//   O04 以前根本没有"措辞"这一档：冷处理和指着鼻子骂算出来一模一样（同 mask、同 felt），
//       外面只能看见 flat/warm，三档根本不可辨。现在按"这一句是什么话"给冷/硬/软三档。
//   O05 句长只有 brevity，没有落到"一句多少字"，也就没法验 -40%。现在给 sentenceChars。
//   O06 标点只有一个 flat，句号到底多了没有没人知道。现在给 period/exclaim/question。
//   O07 延迟只有 mask 一项：3 秒起步、最多 10 秒，跟"生气 1.5~4 倍、封顶 6 分钟"都不是一回事。
//       现在当场倍率 1~4 倍，憋久了额外压着，封顶 6 分钟。
//   O10/O13 说"我没事"和真没事以前只能靠 leakRisk 间接看，现在自报误差和漏出来的语气分开算。
//   O11 说完会轻一点这件事以前没人接：world.spoke 在 io 读之前就被清掉，venting 永远是 0。
//   O12 难过时找人：以前只有 felt/socialPain，没有"要不要主动开口"的判断。

import { clamp, NEG_KINDS } from '../core/consts.js'

// 这一句是什么话（措辞的起因）。只认整句形态，不认单个字：不要把"谢谢"里夹的刺算成软。
const COLD_IN = /^(哦|嗯|随便|都行|算了|行吧|知道了|随你)[。.!！~～\s]*$/
const HARD_IN = /滚|闭嘴|有病|废物|白痴|烦不烦|别烦|傻|蠢|恶心|滚蛋/
const SOFT_IN = /对不起|抱歉|我错了|别生气|抱|亲|喜欢|谢谢|辛苦|慢慢来/
const SAD_IN = /难过|想哭|心里难受|低落|撑不住|委屈|心累|没意思/

// ── O08 语境判定（表情包先看"这一轮是什么话"，再看心情）──────────────
// 只做粗分类，宁可漏判也不误伤：漏判的代价是少发一张图；
// 误判成闲扯的代价是在人说正事/诉苦时丢表情包，那比不发糟得多。
// 正事：要她干活、问问题、贴报错/代码/路径。
const TASK_TALK = /帮我|帮忙|查一下|查下|看一下|看下|搜一下|找一下|这个报错|报错|错误|异常|代码|函数|接口|文档|部署|编译|安装|配置|怎么弄|怎么解决|怎么修|写个|改一下|修一下|日志|文件|路径|命令|脚本|跑一下|翻译|算一下|多少钱|几点|方案|步骤|教程|麻烦你|请问|\bbug\b|\berror\b|traceback|npm|git|docker/i
// 对方在诉苦：第一人称的难受（"我好累""心里堵得慌""刚被骂"），不是"这游戏真难"这种吐槽。
const PAIN_TALK = /我[^，。！？!?]{0,6}(难受|难过|想哭|哭了|委屈|崩溃|撑不住|扛不住|焦虑|害怕|压力大|失眠|心痛|失望|好累|累了|疼|生病)|心里(堵|难受|发慌|闷得慌)|被(骂|甩|裁|分手|欺负)|分手了|失业了|睡不着|不想活|没意思透了/
// 赶时间：只认明确的催，不认"马上到"这种日常。
const HURRY_TALK = /快点|赶紧|急着|赶时间|来不及|马上要|要迟到|开会|先不聊|先不说|回头聊|先这样|晚点聊|在忙|忙完再/
function classifyTalk(text) {
  const t = String(text || '')
  // 诉苦优先：一句"我好难受，帮我查下"里，先照顾人，正事照做不受影响（J07）。
  if (PAIN_TALK.test(t)) return 'comfort'
  if (HURRY_TALK.test(t)) return 'hurry'
  if (TASK_TALK.test(t)) return 'task'
  return 'casual'
}


export function create() {
  const fresh = () => ({
    brevity: 0.3, punctuation: 'normal', replyDelayMs: 0,
    memeTendency: 0.5, voice: { rate: 1, volume: 1 },
    meme: { emotion: 'daily', probability: 0.5, style: 'neutral', allow: true },
    venting: 0, seekComfort: 0, selfReportGap: 0, labeled: 0,
    // 这一拍"到底怎么说话"：三档措辞 / 一句多少字 / 标点 / 憋着的时长 / 要不要找人
    wording: 'normal', sentenceChars: 17,
    marks: { period: 1, exclaim: 0, question: 1 },
    holdMs: 0, reachOut: false, leak: 0, stunnedMs: 0,
    angryPrev: false, frame: 0,
  })
  let s = fresh()

  return {
    id: 'io',
    cover: ['O04', 'O05', 'O06', 'O07', 'O08', 'O09', 'O10', 'O11', 'O12', 'O13'],
    step(w) {
      const pfc = w.get('pfc')
      const ins = w.get('insula')
      const soc = w.get('social')
      const dmn = w.get('dmn')
      const bs = w.get('brainstem') || {}
      const endo = w.get('endocrine') || {}
      if (!pfc) return

      const felt = ins?.felt.intensity ?? 0
      const mask = pfc.display.mask
      const leak = pfc.display.leakRisk
      const dt = clamp(Number(w.tx?.dtMs) || 60_000, 0, 24 * 3600_000)
      const arousal = clamp(Number(bs.arousal ?? 0.6), 0, 1)
      const freeze = clamp(Number(bs.freeze ?? 0), 0, 1)
      const thyroid = clamp(Number(endo.thyroid ?? 0.6), 0, 1)
      const events = Array.isArray(w.tx?.events) ? w.tx.events : []
      const hasEvent = events.some(e => e?.type === 'user' || e?.type === 'assistant')
      // 她刚说出口的话（这一拍她回的），以及这一句是被什么话引出来的
      const said = String(w.lastUserText ?? '').trim()
      // O11：这一拍是不是"刚说完"。world.spoke 在 tick 开头就被清掉，所以还要看上一拍留的
      const spoke = Boolean(w.spoke || w.spokeLast)

      // 这一句是什么话
      const coldIn = COLD_IN.test(said)
      const hardIn = HARD_IN.test(said)
      const softIn = SOFT_IN.test(said)
      const sadIn = SAD_IN.test(said)

      // ── O05 句长 ──────────────────────────────────────────────────
      // 话的长度是"被心情拖着"的，不是每句重算：走惯性，上一句的调子还留着。
      const pair = w.pair || {}
      const pfcRead = w.get('pfc') || {}
      const hypRead = w.get('hypothalamus') || {}
      const dmnRead = w.get('dmn') || {}
      const timePressure = clamp(Number(pfcRead.timePressure ?? pfcRead.display?.timePressure ?? 0), 0, 1)
      const sleepDebt = clamp(Number(hypRead.sleepDebt ?? 0), 0, 1)
      const rumination = clamp(Number(dmnRead.rumination ?? 0), 0, 1)
      const inertia = clamp(0.18 + Math.min(0.42, dt / 120_000), 0.18, 0.62)
      const lowMood = clamp(-(Number(w.mood ?? 0)), 0, 1)
      const targetBrevity = clamp(
        0.2 + 0.5 * mask + 0.3 * felt
        + 0.12 * timePressure + 0.15 * sleepDebt + 0.08 * rumination
        + (pair.escalating ? 0.08 : 0)
        - (pair.softening ? 0.12 : 0)
        + (pair.answeredShort ? 0.05 : 0)
        // 低落时话真的变短（-40% 的来路）：心情差不是"烦"，是"说不出来"
        + 0.65 * lowMood
        // 冷处理：不想多说；硬顶：话短但还要顶；被哄：愿意多两句
        + (coldIn ? 0.18 : 0) + (hardIn ? 0.05 : 0) - (softIn ? 0.08 : 0)
        // B03 低唤醒：困着的时候说话也费劲
        + 0.10 * Math.max(0, 0.55 - arousal)
        // E05 长期低能量：底子虚，话少
        + 0.08 * Math.max(0, 0.6 - thyroid)
        // B04 僵住的那一拍说不出整句
        + 0.25 * freeze,
        0, 1)
      s.brevity = clamp(s.brevity + (targetBrevity - s.brevity) * inertia, 0, 1)
      // 一句大概多少字：平常二十来个字，最丧的时候一个短句（再短就不成人话了，兜底六字）
      s.sentenceChars = Math.max(6, Math.round(24 * (1 - s.brevity)))

      // ── O06 标点 ──────────────────────────────────────────────────
      // 生气句号多、感叹少；开心感叹多。换调子要连续两拍同向才换，避免一句话里反复横跳。
      const pTarget = (pfc.display.toneShift === 'hard' || pfc.display.toneShift === 'flat' || coldIn || hardIn)
        ? 'flat'
        : (pfc.display.toneShift === 'soft' || softIn) ? 'warm' : 'normal'
      if (pTarget === (s.puncTarget || 'normal')) s.puncHold = (s.puncHold || 0) + 1
      else { s.puncTarget = pTarget; s.puncHold = 1 }
      if ((s.puncHold || 0) >= 2 && s.punctuation !== pTarget) s.punctuation = pTarget

      // ── O04 措辞三档 ─────────────────────────────────────────────
      // 被指着骂：硬的（这条最优先——生气不会因为"同时在压着"就变冷）；
      // 压着但漏（O10）：嘴上说没事，语气是冷的；被哄/求和：软的。
      const masking = mask >= 0.45 && felt >= 0.35 && !spoke
      s.wording = hardIn ? 'hard'
        : (coldIn || (masking && !softIn) || pfc.display.toneShift === 'flat') ? 'cold'
          : (softIn || (pfc.display.toneShift === 'soft' && mask < 0.4)) ? 'soft'
            : 'normal'
      // 标点画像：生气时一句里好几个句号、一个感叹号都没有；软的时候反过来
      s.marks = {
        period: s.wording === 'hard' ? 2 + Math.round(1.5 * clamp(felt, 0, 1))
          : s.wording === 'cold' ? 1
            : s.wording === 'soft' ? 0 : 1,
        exclaim: s.wording === 'soft' ? 1 : 0,
        question: s.wording === 'soft' ? 1 : 0,
      }

      // ── O07 延迟 ──────────────────────────────────────────────────
      // 当场：生气是平时的 1.5~4 倍（不是恒定地慢）。憋久了还要额外压着，但封顶 6 分钟。
      // B03：低唤醒（深夜/缺觉）也回得慢 —— 这是"没反应过来"，不是"不想理你"。
      const anger = clamp((mask - 0.3) / 0.4, 0, 1)
      const ratio = clamp(1 + 3 * anger + 0.5 * clamp(leak, 0, 1)
        + (hardIn ? 0.3 : 0) + (coldIn ? 0.5 : 0)
        + 2.5 * Math.max(0, 0.55 - arousal), 1, 4)
      const holding = (hardIn || coldIn || mask > 0.5) && felt > 0.3 && !spoke
      // 只有她真听见了什么，这个计时器才走；安静下来它不许自己涨（否则"没人的时候一直在憋气"）
      if (hasEvent) {
        if (holding && s.angryPrev) s.holdMs = clamp(s.holdMs + dt * 0.5, 0, 360_000)
        else if (!holding) s.holdMs = clamp(s.holdMs - dt * 2, 0, 360_000)
        s.angryPrev = holding
      }
      s.replyDelayMs = clamp(3_000 * ratio + s.holdMs, 0, 360_000)

      // ── O08 表情包 ────────────────────────────────────────────────
      // 表情包不是"有情绪就发"，也不是"丧了就不发"：先看这一轮是什么话，再看心情。
      // 语境（正事 / 对方诉苦 / 赶时间）是一票否决；心情只在"能发"的语境里决定发哪种、多想发。
      const memeContext = classifyTalk(said)
      const casualTurn = memeContext === 'casual'

      // 丧的时候不是"不想发图"，而是"只发丧的"：下限抬到 0.35，别让倾向把发图关死
      s.memeTendency = clamp(0.6 - 0.5 * felt - 0.3 * pfc.display.mask, 0.35, 1)

      // 跟随"此刻"的效价与主导情绪，不是只跟随底色心情
      const curMood = w.mood ?? 0
      const mainKind = w.emotions?.[0]?.kind ?? null
      const amy = w.get('amygdala')
      const nowValence = clamp((amy?.rewardPE ?? 0) - 0.7 * (amy?.threat ?? 0), -1, 1)
      const negish = (mainKind && (NEG_KINDS.has(mainKind) || /烦|心痛|委屈|生气|失望|难过|焦虑|紧张|害怕|羞/.test(mainKind)))
        // 她刚说的话本身带丧气：这一拍就算情绪还没成形，也别推亮色表情
        || (/烦|累死|崩溃|受不了|气死|无语|服了|不想干|心累|难过|失望/.test(String(w.lastUserText || '')) && !/厉害|谢谢|辛苦|开心|棒|喜欢/.test(String(w.lastUserText || '')))
      // 只有"真被惹到"才归丧；但底色心情持续很低时，也该走丧的（不是只有挨骂才算）
      const strongNeg = negish || (nowValence < -0.35 && felt > 0.25) || curMood < -0.35
      const positiveNow = !negish && ((mainKind && !NEG_KINDS.has(mainKind) && Math.abs(nowValence) > 0.05) || nowValence > 0.2)
      const isAngry = mainKind && ['生气', '厌烦'].includes(mainKind)
      const isShy = mainKind && ['害羞', '心动'].includes(mainKind)
      const isConfused = mainKind && ['困惑', '惊讶', '焦虑', '紧张'].includes(mainKind)
      // 发图的门槛不能由"心情差"一路压到底：丧的时候也常发丧图。
      // O08 的"低落时减少"落在概率上：闲扯时丧 0.7 / 平常 0.82 / 开心 0.9（上一版 0.5 / 0.62 / 0.8），
      // 整体上抬，效价只做微调；上下限仍是 0.35~0.95。
      const baseP = negish ? 0.7 : positiveNow ? 0.9 : 0.82
      const p = clamp(baseP + 0.25 * nowValence + 0.15 * (curMood - 0.1), 0.35, 0.95)
      // 不再只给一个分类：给一个"这轮想发什么"的检索词，图库那边照着挑
      const 情境 = isAngry ? '生气 无语'
        : isShy ? '害羞 脸热'
        : isConfused ? '困惑 问号'
        : strongNeg ? '难过 低落'
        : positiveNow ? '开心 贴贴'
        : '日常 摸鱼'
      // 能不能发由语境说了算。0.45 只兜"心情压着、没那么想发"的闲扯：低于它不给指令，宁可不发。
      // 顺带说明：旧版注入的门限是 0.18 / 0.12，而概率下限 0.35、倾向下限 0.35，
      // 这两个门限永远够不着——"发不发"其实从来没被这些数管过，问题出在行文不可执行。
      // 主人定的规则：正事、诉苦时也可以发，只要表情包跟当下心情对得上
    const allow = true
      // 不能发的语境里，倾向也跟着降（面板看得见；注入那边还会一票否决）
      if (!casualTurn) s.memeTendency = clamp(s.memeTendency * 0.6, 0.2, 1)
      s.meme = {
        emotion: isAngry ? 'angry' : isShy ? 'shy' : isConfused ? 'confused'
          : strongNeg ? 'sad' : positiveNow ? 'happy' : 'daily',
        probability: p,
        style: strongNeg ? 'emo' : positiveNow ? 'bright' : 'neutral',
        allow,
        // 语境和理由留在读数里：面板/测试能看出"这行没出"是因为正事/诉苦/赶时间，不是随机
        context: memeContext,
        query: 情境,
      }

      // ── O09 语音（简）──
      // 只给语速/音量两个参数：压得越狠语速越慢；长期低能量（E05）也慢；低落时更慢。
      // 气得冲时音量抬，僵住那一拍音量收一点（说不出大声的话）。
      s.voice = {
        rate: clamp(1 - 0.2 * mask - 0.3 * Math.max(0, 0.65 - thyroid) - 0.15 * lowMood - 0.1 * freeze, 0.7, 1.15),
        volume: clamp(1 - 0.1 * felt + (s.wording === 'hard' ? 0.25 : 0) - 0.1 * freeze, 0.7, 1.15),
      }

      // ── O10 抑制与泄漏（已在 pfc，这里透出）──
      s.leak = leak
      // B04 僵住的那几秒：不是"不想理你"（那是 O07 的延迟），是当下动不了。
      // 单独给一个时长，别混进 replyDelayMs —— 混进去就分不清"气得不想回"和"被吓住"。
      s.stunnedMs = Math.round(4000 * freeze)

      // ── O11 表达后的释放 ──────────────────────────────────────────
      // 真说出来了，那股劲就泄一点；没说就一直憋着（不衰减）。
      const ventTarget = spoke && felt > 0.2 ? clamp(0.35 + 0.6 * felt, 0, 1) : 0
      s.venting = clamp(s.venting + (ventTarget - s.venting) * (spoke ? 0.6 : 0.1), 0, 1)

      // ── O12 倾诉：难过时会找人说话 ──
      const pain = clamp(Number(soc?.socialPain ?? 0), 0, 1)
      s.seekComfort = clamp(felt * 0.6 + pain * 0.4 + (sadIn ? 0.2 : 0) + 0.15 * lowMood, 0, 1)
      s.reachOut = s.seekComfort >= 0.5 && (felt > 0.3 || sadIn || pain > 0.35)

      // ── O13 自我报告误差：说"没事"和真实状态可以分开 ──
      s.selfReportGap = clamp(mask * felt, 0, 1)
      // P19 命名
      s.labeled = w.labeled ? 1 : 0
      s.frame += 1
    },
    read() {
      return {
        frame: s.frame,
        brevity: s.brevity, punctuation: s.punctuation, replyDelayMs: s.replyDelayMs,
        memeTendency: s.memeTendency, voice: { ...s.voice },
        meme: { ...s.meme },
        venting: s.venting, seekComfort: s.seekComfort, selfReportGap: s.selfReportGap,
        labeled: s.labeled,
      }
    },
    /**
     * 这一拍的表达细则（不进 read()：它是"怎么说"的三个档位和尺寸，不是稳态读数）。
     * O04 措辞三档 / O05 一句多少字 / O06 标点画像 / O07 憋着的时长 / O12 要不要开口。
     */
    detail() {
      return {
        wording: s.wording, sentenceChars: s.sentenceChars,
        marks: { ...s.marks }, holdMs: s.holdMs, reachOut: s.reachOut,
        leak: s.leak, venting: s.venting, stunnedMs: s.stunnedMs,
      }
    },
    snapshot: () => ({ ...s, voice: { ...s.voice }, marks: { ...s.marks }, meme: { ...s.meme } }),
    restore(o) { if (o) s = { ...fresh(), ...o } },
    health: () => ({ ok: true, degraded: false, frame: s.frame }),
  }
}
