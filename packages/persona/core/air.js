// R10 读空气：这一轮对方是"在说正事/在诉苦/在闹着玩/在发火"。
// 规格原文：「读空气：社交监控」。只做一件事：判断现在该不该贫、该不该收。
const SERIOUS = /(帮我|麻烦|请问|怎么|为什么|能不能|是不是|方案|代码|报错|部署|文档|需求|任务|计划)/
const VENTING = /(累了|烦死|难受|撑不住|崩了|委屈|想哭|不开心|压力|焦虑)/
const ANGRY = /(闭嘴|别烦|滚|无语|随便|失望|你行不行|到底)/
const PLAYFUL = /(哈哈|笑死|草|好耶|诶嘿|233|乐死|好玩)/

/**
 * @returns {{ air: 'serious'|'venting'|'angry'|'playful'|'casual', directive: string|null, why: string }}
 */
export function readAir(text = '') {
  const t = String(text || '')
  // 发火优先：带刺的话先收着
  if (ANGRY.test(t)) return { air: 'angry', directive: '对方在火头上，先别接玩笑', why: 'angry-cue' }
  if (VENTING.test(t)) return { air: 'venting', directive: '对方在难受，别讲道理也别贫', why: 'venting-cue' }
  if (PLAYFUL.test(t)) return { air: 'playful', directive: null, why: 'playful-cue' }
  if (SERIOUS.test(t)) return { air: 'serious', directive: '这是正事，别闹，答清楚', why: 'serious-cue' }
  return { air: 'casual', directive: null, why: 'no-cue' }
}
