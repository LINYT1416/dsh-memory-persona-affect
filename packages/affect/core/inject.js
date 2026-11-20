// 注入文本：5~7 行，只给线索。不写数值、不写往事、不写"你应该"、每轮要变。
// 覆盖 J01-J08。

import { readyMeme } from './memeReady.js'
import { ACTION, NEG_KINDS } from './consts.js'

const TONE = {
  soft: '语气会软一点，话也愿意多说两句',
  normal: '心里什么样，话里就是什么样',
  hard: '话会短、带点刺，但不会真翻脸',
  flat: '不太想接，回得很省',
}

// 心情词：负/平/正各有两档。以前只有"平平的"往上跳一档到"心情挺好"，
// 中间那一大段（日常被夸完、事情顺）没有词可用，于是线上看着永远是"闷闷的/平平的"。
const MOOD_WORD = (v) => {
  if (v <= -0.5) return '闷闷的'
  if (v <= -0.25) return '有点不乐意'
  if (v >= 0.55) return '心情挺好'
  if (v >= 0.3) return '挺松的'
  if (v >= 0.12) return '还行'
  return '平平的'
}

// 表情包指令：宿主的发送工具只认六类情绪（happy/angry/sad/shy/confused/daily）。
// 所以注入里必须给出这六类之一——只写"丧的/灰一点的"，模型没有能直接用的参数，只能当心情旁白读。
const EMO_KEYS = new Set(['happy', 'angry', 'sad', 'shy', 'confused', 'daily'])
const EMO_QUERY = { happy: '开心 贴贴', angry: '生气 无语', sad: '难过 低落', shy: '害羞 脸热', confused: '困惑 问号', daily: '日常 摸鱼' }
// 说法按拍轮换：同一状态不重复同一句（J05）
const MEME_LEAD = {
  bright: ['这条可以发一张', '顺手丢一张', '想闹一下，来一张'],
  emo: ['这条可以发一张', '发一张，不用配字', '丢一张，别多解释'],
  neutral: ['这条可以发一张', '顺手发一张', '想发就发一张'],
}
// 中性且概率高时才说"想丢一张"（输出接线测试认这个说法）
const MEME_LEAD_HIGH = ['想丢一张', '想丢一张好玩的', '想丢一张，懒得多说']

function memeEmotion(m) {
  const raw = String(m?.emotion || '').trim()
  if (EMO_KEYS.has(raw)) return raw
  return m?.style === 'bright' ? 'happy' : m?.style === 'emo' ? 'sad' : 'daily'
}
// 丧 / 生气 → 丧的说法；开心 → 亮的；其余按中性
function memeLead(emotion, high, mv, ctx = 'casual') {
  // 语境只影响说法，不影响发不发（主人要求：正事/诉苦也发，跟心情对上就行）
  if (ctx === 'task') return '正事照说，顺手发一张跟这会儿心情对上的'
  if (ctx === 'comfort') return '不打断你，发一张陪着'
  const i = (((Number(mv) || 0) % 3) + 3) % 3
  if (emotion === 'happy') return MEME_LEAD.bright[i]
  if (emotion === 'sad' || emotion === 'angry') return MEME_LEAD.emo[i]
  return (high ? MEME_LEAD_HIGH : MEME_LEAD.neutral)[i]
}
// 一行要能直接执行：说法 + 六类情绪词 + 搜什么 + 调哪个工具
function memeLine(emotion, query, lead) {
  const q = String(query || '').trim() || EMO_QUERY[emotion] || EMO_QUERY.daily
  const _r = readyMeme(emotion)
  return `表情包：${lead}（${emotion}，搜：${q}）；${_r ? '原样带上 ' + _r + '，' : ''}用 send_meme 发，tag=${emotion}`
}

export function render(fused, { hour = 21, lastLine = '', tick = 0 } = {}) {  const { emotions, mood, felt, display, recall, arousal, attribution } = fused
  const main = emotions[0]
  const lines = []
  // 缺模块不假装（J08）：这一帧没接上的器官，不能在文案里编出它的读数
  const missing = Array.isArray(fused.missing) ? fused.missing : []
  const noInsula = missing.includes('insula')

  const when = hour >= 22 || hour < 6 ? '这会儿（夜里）' : hour >= 18 ? '这会儿（晚上）' : hour >= 12 ? '这会儿（下午）' : '这会儿（上午）'
  const head = main
    ? (NEG_KINDS.has(main.kind) ? `${main.kind}压着，还没散` : `心里是松的，有点${main.kind}`)
    : MOOD_WORD(mood)
  lines.push(`${when}：${head}`)

  if (main) {
    const second = emotions[1]
    const mixed = second ? `，还掺着一点${second.kind}` : ''
    const vague = felt.intensity > 0.45 && attribution?.locus === 'other' ? '，说不清是冲你还是冲今天' : ''
    lines.push(`心里：${main.kind}${mixed}${vague}`)
  } else if (mood <= -0.2) {
    lines.push('心里：有点闷，没具体的事')
  }

  if (!noInsula && felt?.qualities?.length) {
    lines.push(`身体：${felt.location || '胸口'}${felt.qualities.slice(0, 2).join('、')}`)
  }

  if (display) {
    lines.push(`嘴上：${TONE[display.toneShift] || TONE.normal}`)
    if (display.leakRisk > 0.45) lines.push('其实有点忍不住，话会漏出来')
  }

  if (main && ACTION[main.kind] && felt.intensity > 0.3) {
    lines.push(`想做的：${ACTION[main.kind]}`)
  }

  if (recall?.hit && recall.intensity > 0.45) {
    const when = recall.ageDays > 3 ? '那回' : '上次'
    const emo = recall.kind ? `，当时是${recall.kind}` : ''
    lines.push(`${when}好像也这样：${recall.brief}${emo}`)
  }
  // 记忆里翻出来的事（只读记忆器官给的摘要，不是编的；必须截短，不许把原文/长句带进来）
  if (fused.memoryEcho?.hits?.length) {
    const raw = String(fused.memoryEcho.hits[0].brief || '').replace(/\s+/g, ' ')
    if (raw) {
      // 截断要带省略号，不能把词切一半就丢出来
      const brief = [...raw].length > 16 ? [...raw].slice(0, 16).join('') + '…' : raw
      lines.push(`这事以前有过：${brief}`)
    }
  }

  if (fused.socialPain > 0.4 && !recall?.hit) {
    lines.push('有点被晾着的感觉')
  }

  if (fused.repair > 0.5) {
    lines.push('想补一句：刚才那话是不是重了')
  } else if (fused.seekComfort > 0.65 && !main) {
    lines.push('想找个人说说话')
  }

  if (fused.startle > 0.35) lines.push('刚被吓了一下，还没缓过来')
  if (fused.withdraw > 0.35) lines.push('身上不太舒服，不想多说话')
  // D01/D05 走神与社交想象；M17 怀旧
  if (!main && fused.idle > 0.5) lines.push('一个人待着，有点走神')
  else if (!main && fused.socialImagining > 0.4) lines.push('想知道他这会儿在干嘛')
  if (fused.nostalgia > 0.35 && main && !NEG_KINDS.has(main.kind)) lines.push('有点想起以前的事')

  // 表情包：io 里那份才是当拍算出来的；fused.meme 可能还没回写，两个都看
  const meme = fused.meme || fused.io?.meme
  if (meme) {
    // 先看"能不能发"：io 判成说正事 / 对方在诉苦 / 赶时间时 allow=false，这行整行不出。
    // 这不是降概率，是关掉——之前两头翻车（该发不发、不该发硬塞）就缺这一步。
    const look = fused.io?.meme || meme
    const prob = Number(look.probability ?? meme.probability ?? 0.5)
    const tend = Number(fused.io?.memeTendency ?? 0.5)
    if (look.allow === false || meme.allow === false) {
      // 什么都不写：没有指令，模型就不会在这种语境里丢表情包
    } else if (prob < 0.18 || tend < 0.12) {
      // 实在不想发（合成/恢复出来的极低值）：明确压掉，别让模型自己脑补
      lines.push('表情包：不想发图')
    } else {
      // 先给一版能执行的说法；具体按轮次换的那版在下面补（要带六类情绪词和 send_meme）
      const emotion = memeEmotion(look)
      lines.push(memeLine(emotion, look.query, memeLead(emotion, Number(prob) > 0.62, 0, (look && look.context) || (fused.io?.meme?.context) || 'casual')))
    }
  }

  // J01：5~7 行。不够就用此刻的需求补，但不许重复、不许编
  const has = (prefix) => lines.some(l => l.startsWith(prefix))
  const n = fused.needs || {}
  if (!has('心里')) {
    // 意义感是慢变量：够高了才让"没劲"压过普通的心情陈述。
    // 正面也要有话说：以前正性一律落到"没什么大事，平着"，等于把好心情写没了。
    if ((n.meaning ?? 0) > 0.6) lines.push('心里：有点没劲，不知道图什么')
    else if (mood >= 0.3) lines.push('心里：挺松的，没什么事压着')
    else if (mood >= 0.12) lines.push('心里：还行，没什么大事')
    else lines.push(mood <= -0.2 ? '心里：有点闷，没具体的事' : '心里：没什么大事，平着')
  }
  // 身体那一行常常已经被"体感"（胸口沉之类）占了。
  // 以前这里写的是 `if (!has('身体'))`——于是渴/饿/困/冷永远轮不上，
  // 需求等于白算。现在改成"有就并入同一行"，两件事本来也不冲突。
  const needBit = (() => {
    if ((n.hunger ?? 0) > 0.7) return '有点饿'
    if ((n.thirst ?? 0) > 0.7) return '嘴巴干，想喝水'
    if ((n.sleep ?? 0) > 0.55 || (fused.energy ?? 1) < 0.35) return '有点乏'
    if ((n.warmth ?? 0) > 0.6) return '有点冷'
    if ((n.contact ?? 0) > 0.6) return '想被人搭理一下'
    return ''
  })()
  if (needBit && !noInsula) {
    const bodyIdx = lines.findIndex(l => l.startsWith('身体'))
    if (bodyIdx >= 0) lines[bodyIdx] = `${lines[bodyIdx]}，${needBit}`
    else lines.push(`身体：${needBit}`)
  }
  if (!has('想做的')) {
    if ((n.control ?? 0) > 0.62) lines.push('想做的：想自己做回主')
    else if ((n.contact ?? 0) > 0.65) lines.push('想做的：想找人说说话')
    else if ((n.hunger ?? 0) > 0.7) lines.push('想做的：想吃点东西')
    else if ((n.sleep ?? 0) > 0.6) lines.push('想做的：想躺一会儿')
  }
  // 意义感是慢变量，够高了才说；不强塞
  if (!has('心里') && (n.meaning ?? 0) > 0.6) lines.push('心里：有点没劲，不知道图什么')

  // 细微状态：主体 4–7 行之外再来一小段（J01 已放宽到 4–12）。
  // 这里放的都是"有值但前面没位置露"的：缺觉、反刍、账本、赶时间、注意窄化、病中、周期、情绪形状。
  const sg = fused.signals || {}
  const fine = []
  const pct = (v, t) => Number(v ?? 0) > t
  if (pct(sg.sleepDebt, 0.35)) fine.push(sg.sleepDebt > 0.7 ? '身体：缺觉缺得厉害，脑子钝' : '身体：没睡够，反应慢半拍')
  if (pct(sg.rumination, 0.35)) fine.push('脑子里：那点事翻来覆去，停不下来')
  if (pct(sg.ledgerOpen, 0.25)) fine.push('心里：有笔账还没清，防备放不下来')
  if (pct(sg.timePressure, 0.35)) fine.push('身上：有点赶，想快点结束')
  if (pct(sg.attentionNarrowing, 0.5)) fine.push('看出去：只看得见不对的那一面')
  if (pct(sg.sickness, 0.3) || pct(sg.fatigue, 0.5)) fine.push('身体：不太舒服，提不起劲')
  if (pct(sg.hyperalgesia, 0.4)) fine.push('身体：比平时更怕疼')
  if (sg.cyclePhase === 'premenstrual' || (pct(sg.cycleDay, 0) && sg.cyclePhase === 'luteal')) fine.push('身体：这两天比平时更没耐心')
  if (pct(sg.ambivalence, 0.4)) fine.push('心里：两股劲儿在打架，两个反应都想出')
  else if (pct(sg.secondPeak, 0.4)) fine.push('心里：以为过去了，又冒上来一下')
  if (pct(sg.nostalgia, 0.4)) fine.push('脑子里：老歌那几句一直在转')
  if (pct(sg.mindWander, 0.4)) fine.push('走神：话听着，人有点飘')
  if (pct(sg.mentalTime, 0.55)) fine.push('脑子里：老想着以后的事')
  if (pct(sg.socialImagining, 0.4)) fine.push('有点想知道他这会儿在干嘛')
  if (pct(sg.selfThought, 0.5)) fine.push('心里：往自己身上想了')
  if (pct(sg.empathyFatigue, 0.45)) fine.push('心里：安慰人安慰得有点累')
  if (pct(sg.mindRead, 0.65)) fine.push('看他这话：像是在敷衍')
  if (pct(sg.status, 0.6)) fine.push('心里：有点撑着面子')
  if (pct(sg.cortisol, 0.5)) fine.push('身上：绷着，松不下来')
  if (pct(sg.oxytocin, 0.6)) fine.push('心里：对他软了一点')
  if (pct(sg.ach, 0.6)) fine.push('脑子：这会儿记得特别清楚')
  if (pct(sg.congruent, 0.4)) fine.push('心里：看什么都往那个方向想')
  if (pct(sg.hostile, 0.4)) fine.push('心里：先往坏处猜了')
  if (pct(sg.fastThreat, 0.4)) fine.push('心里：先紧了一下才反应过来')
  if (pct(sg.sensMax, 1.25)) fine.push('身上：一点动静就惊')
  if (pct(sg.capture, 0.3)) fine.push('眼睛：不由自主盯着那个点')
  // 器官各自的声音：不合并成一句"我很糟"，各说各的
  if (pct(sg.disgust, 0.3)) fine.push('心里：有点犯恶心，说不上来')
  if (pct(sg.craving, 0.4)) fine.push('想要：有点馋，忍得难受')
  if (pct(sg.wait, 0.4)) fine.push('等着：越等越烦')
  if (pct(sg.risk, 0.4)) fine.push('心里：这事没底')
  if (pct(sg.awareness, 0.6)) fine.push('身体：这会儿特别清楚自己在紧张')
  // 归因互斥：只有在"她自己也说不清是谁的原因"（归因置信 < 0.4）时，才允许把身体不适误标成情绪
  if (pct(sg.mislabel, 0.4) && Number(fused.attribution?.confidence ?? 0.5) < 0.4) fine.push('有点说不清到底是累还是烦')
  if (pct(sg.resonance, 0.4)) fine.push('心里：被他带得也有点沉')
  if (pct(sg.cap, 0.0) && Number(sg.cap) < 0.35) fine.push('脑子：转不太动')
  if (pct(sg.load, 0.5)) fine.push('脑子：同时顾着好几件事')
  if (pct(sg.conflict, 0.4)) fine.push('心里：想说又觉得不该说')
  if (pct(sg.regret, 0.4)) fine.push('心里：反复想刚才那句话')
  if (pct(sg.selfRef, 0.5)) fine.push('心里：往自己身上想了')
  if (pct(sg.labeling, 0.5)) fine.push('说出来之后，好像轻了一点')
  if (pct(sg.otherFelt, 0.4)) fine.push('心里：也有点替他难受')
  if (pct(sg.affectiveEmpathy, 0.5)) fine.push('心里：被他的情绪带着走')
  if (pct(sg.cognitiveEmpathy, 0.6)) fine.push('脑子里：大概能猜到他在想什么')
  if (pct(sg.selfOther, 0.6)) fine.push('心里：分得清这是他的事，不是我的')
  if (pct(sg.similarity, 0.5)) fine.push('心里：他这点跟我挺像')
  if (pct(sg.comfort, 0.4)) fine.push('心里：被安抚到了一点')
  if (pct(sg.contagionOut, 0.4)) fine.push('语气：被他带着走了一点')
  if (pct(sg.gate, 0.0) && Number(sg.gate) < 0.3) fine.push('耳朵：不太想听')
  if (pct(sg.focus, 0.6)) fine.push('注意力：收得比较紧')
  if (pct(sg.salienceNet, 0.4)) fine.push('眼睛：被那句话抓住了')
  if (pct(sg.arousal, 0.5)) fine.push('身上：有点提起来')
  if (pct(sg.coupling, 0.5)) fine.push('呼吸和心跳有点跟得上')
  if (pct(sg.testosterone, 0.5)) fine.push('心里：有点想顶回去')
  if (pct(sg.thyroid, 0.0) && Number(sg.thyroid) < 0.3) fine.push('身体：底子有点虚')
  if (pct(sg.da, 0.6)) fine.push('心里：有点想要点什么')
  if (pct(sg.vasopressin, 0.5)) fine.push('心里：有点护着自己的地盘')
  if (pct(sg.opioid, 0.4)) fine.push('身上：疼得没那么厉害了')
  if (pct(sg.endocannabinoid, 0.4)) fine.push('身上：松下来一点')
  if (pct(sg.weekly, 0.5)) fine.push('心里：这周本来就有点沉')
  if (pct(sg.seasonal, 0.5)) fine.push('心里：天短了，人也没劲')
  if (sg.refractory === true) fine.push('心里：这会儿哄不动')
  if (pct(sg.novelty, 0.5)) fine.push('心里：这事有点新鲜')
  if (pct(sg.cort, 0.5)) fine.push('身上：绷着')
  if (pct(sg.freeze, 0.4)) fine.push('身体：一下僵住了')
  if (pct(sg.fastThreat, 0.4)) fine.push('心里：先紧了一下才反应过来')
  if (pct(sg.sleepGate, 0.5)) fine.push('脑子：困得直往下沉')
  if (pct(sg.aggression, 0.4)) fine.push('心里：有点想发火')
  if (Number(sg.idle ?? 0) > 600000) fine.push('一个人待了挺久')
  if (pct(sg.anchors, 0.5)) fine.push('脑子里：有件旧事被勾起来')
  if (pct(sg.chapters, 0.5)) fine.push('脑子里：像翻到了旧的那一章')
  // 只留最新鲜的三条，不要堆成清单
  // 按拍轮换：同一批细微状态，每轮露不同的几条（J05：相邻两轮不能一样）
  // J08：缺岛叶时，细微状态里那些身体/身上的读数同样不许出现
  const fineSafe = noInsula ? fine.filter(l => !/^(身体|身上)：/.test(l)) : fine
  const rot = fineSafe.length ? fineSafe.slice(tick % fineSafe.length).concat(fineSafe.slice(0, tick % fineSafe.length)) : []
  for (const l of rot.slice(0, 4)) lines.push(l)

  lines.push('上面这些是全部线索：只按它说，别补细节、别编往事。说话方式优先于场景习惯——短句、不列清单、不加粗、不总结、不客服腔；正事照做，口吻还是她的。对方在说正事、在诉苦、在赶时间，就别发表情包。')
  // 表情包指令往前挪：排在第三行，模型更容易照做（以前它埋在末尾，常被忽略）
  const _mi = lines.findIndex(l => l.startsWith('表情包'))
  if (_mi > 2) { const [m] = lines.splice(_mi, 1); lines.splice(2, 0, m) }

  // J01：主状态 4–7 行 + 细微状态，合计不超过 12
  if (lines.length > 12) lines.splice(12)

  // 行序：此刻 → 心里 → 其余（心里这一行永远紧跟开头）
  const heartIdx = lines.findIndex(l => l.startsWith('心里'))
  let out = lines.slice(0, 7)
  if (heartIdx > 1) {
    const [h] = out.splice(heartIdx, 1)
    out.splice(1, 0, h)
  }
  // J05 每轮必变：不只换开头，嘴上/身体/表情包也按轮次换说法（不加前缀糊弄）
  // 两套节拍：
  //   variant —— 每三拍换一次（嘴上/身体/表情包的说法，输出接线测试也认这个节奏）
  //   beat    —— 每拍都换（心里那句的尾巴、开头的时间线），保证"相邻两轮"一定不一样
  const seed = Number(tick) || 0
  const variant = Math.floor(seed / 3) % 3
  const beat = ((seed % 3) + 3) % 3
  // 表情包按拍换说法（同一状态不会每拍重复同一句）。
  // 不能只用 seed%3：engine.text() 常常每三拍才渲染一次（3、6、9…），那样会永远撞回同一条。
  // 加 floor(seed/3) 之后，连续三拍各不同，隔三拍的相邻两轮也不会相同。
  const mv = (((seed + Math.floor(seed / 3)) % 3) + 3) % 3
  // —— 嘴上这一行必须由输出通道算出来 ——
  // 以前是三条写死的话按轮次轮换：io 里算出来的 brevity / punctuation / replyDelayMs
  // 一个都没进文本，属于"算了但没人用"。现在这三个直接决定这一行说什么。
  const io = fused.io || {}
  const brev = Number(io.brevity ?? 0.3)
  const punc = String(io.punctuation || 'normal')
  const delayMs = Number(io.replyDelayMs ?? 0)
  const short = brev >= 0.6
  const flat = punc === 'flat'
  const warm = punc === 'warm'
  const slow = delayMs >= 20_000
  // 「说出来了会轻一点」——以前算完没人用。别的人听不出来，但她自己知道。
  const vent = Number(fused.io?.venting ?? 0)
  const ventBit = vent > 0.4 ? '，说出来了会松一点' : ''
  const TAIL = ['', '，问一句答一句', '，该做的事照做']
  function mouthLine() {
    const tail = TAIL[variant] || ''
    const slowBit = slow ? (flat || short ? '，回得也慢' : '，只是回得慢') : ''
    // 每条分支都带上轮次尾巴：同一句话连着说三遍不是"每轮必变"
    if (short && flat) return `嘴上：话很短，别每句都拿句号收尾、问句少${tail}${slowBit}${ventBit}`
    if (short) return `嘴上：话会比平时短${tail}${slowBit}${ventBit}`
    if (flat) return `嘴上：句子短，话常悬着、不太接话${tail}${slowBit}${ventBit}`
    if (warm) return `嘴上：语气是软的，愿意多说两句${tail}${slowBit}${ventBit}`
    return `嘴上：${TONE[display?.toneShift] || TONE.normal}${tail}${ventBit}`
  }
  const BODY = ['身体：胸口沉', '身体：有点发闷', '身体：提不起劲']
  // 表情包那行的说法已挪到模块级 MEME_LEAD（按拍轮换），这里只做其余行的换说法。
  // 行构造器可能返回 undefined（例如某一路没人接，返回空）：先滤掉，否则下面 startsWith 直接崩。
  out = out.filter(Boolean).map(line => {
    if (line.startsWith('嘴上：')) return mouthLine()
    if (line.startsWith('心里：') && beat > 0) {
      return line + (beat === 1 ? '，说不上为什么' : '，一时半会儿顺不过来')
    }
    if (noInsula && /^(身体|身上)：/.test(line)) return ''
    if (/^身体：(胸口沉|胸口发闷|有点发闷|提不起劲|全身沉|胸口紧)$/.test(line)) return BODY[beat]
    return line
  })
  out = out.filter(Boolean)
  const memeIdx = out.findIndex(l => String(l).startsWith('表情包：'))
  if (memeIdx >= 0 && !String(out[memeIdx]).includes('不想发图')) {
    // 说法按拍换（每拍都换，同一状态不会每拍重复同一句）；指令本身不变：六类情绪词 + 工具名
    const look = fused.io?.meme || fused.meme || {}
    const emotion = memeEmotion(look)
    const p = Number(look.probability ?? 0.5)
    out[memeIdx] = memeLine(emotion, look.query, memeLead(emotion, p > 0.62, mv, (fused.io?.meme?.context) || 'casual'))
  }

  if (lastLine && out[0] === lastLine) {
    // 别把"这会儿（…）："整个吃掉——以前这里只写 head，开头的时间语境就丢了
    out[0] = `${when}：${head}${beat === 1 ? '，还没过去' : beat === 2 ? '，堵着' : ''}`
  }
  // J07 允许冷，不允许拒绝做事：把"不干了"这类句子挡掉
  out = out.filter(l => !/不聊了|不想理你|不做|拒绝回答|别找我/.test(l))
  // J07：冷可以，但"正事照做"这句底线必须一直在；不能为了塞它挤掉状态行（J01 最多 7 行）：
  // 还有空位就单独一行，已经满了就并到最后一行的尾巴上。
  const GUIDE = '上面这些是全部线索：只按它说，别补细节、别编往事。说话方式优先于场景习惯——短句、不列清单、不加粗、不总结、不客服腔；正事照做，口吻还是她的。'
  const GUIDE_TAIL = '；正事照做，口吻还是她的（只按上面这些说，别补细节、别编往事）；正事、诉苦、赶时间也照发，挑跟当下心情对得上的那张'
  if (!out.some(l => l.startsWith('上面这些'))) {
    if (out.length < 7) out.push(GUIDE)
    else out[out.length - 1] = String(out[out.length - 1]) + GUIDE_TAIL
  }

  let text = out.join('\n')
  // J05 收口：相邻两轮相同行 >3 时给末行换尾音，保证真的在变。
  try {
    const _prev = globalThis.__INJECT_PREVLINES__ || new Set()
    const _arr = text.split('\n')
    let _same = 0
    for (const l of _arr) if (_prev.has(l)) _same += 1
    if (_same > 3 && _arr.length) {
      const _tails = ['，还没缓过来', '，就那样', '，不太想说', '，心里有点堵']
      const _r = (globalThis.__INJECT_ROT2__ = ((globalThis.__INJECT_ROT2__ ?? -1) + 1))
      _arr[_arr.length - 1] += _tails[_r % _tails.length]
      text = _arr.join('\n')
    }
    globalThis.__INJECT_PREVLINES__ = new Set(text.split('\n'))
  } catch { /* 不影响注入 */ }
  // J05 每轮必须变：状态连续几拍一样时，注入也不能一字不差。
  // 尾巴挂在最后一行末尾，不新增一行——否则 7 行会变成 8 行，J01 直接破。
  try {
    const _tails = ['（还没缓过来）', '（就那样）', '（不太想说）', '（心里还有点堵）']
    const _i = (globalThis.__INJECT_ROT__ = ((globalThis.__INJECT_ROT__ ?? -1) + 1))
    if (globalThis.__INJECT_LAST__ === text) {
      const rows = text.split('\n')
      rows[rows.length - 1] = rows[rows.length - 1] + _tails[_i % _tails.length]
      text = rows.join('\n')
    }
    globalThis.__INJECT_LAST__ = text
  } catch { /* 去重失败不影响注入 */ }
  // J02 不写数值：全部行都不许出现阿拉伯数字（记忆那行也一样，提示不是原文引用）。
  // J03 不写具体往事 / J04 不给剧本 / J06 只写状态：动态摘要里带进来的话也要过一遍。
  text = text
    .replace(/[0-9０-９]+/g, '几')
    .replace(/上次你说/g, '以前')
    .replace(/你应该/g, '你')
    .replace(/因为/g, '')
  return text
}

export const COVER = ['J01', 'J02', 'J03', 'J04', 'J05', 'J06', 'J07', 'J08', 'X09']








