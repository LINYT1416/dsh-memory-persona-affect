// R06 嫉妒与占有：他跟别人也好，心里会有点不是滋味。
// 但人设不是醋坛子：只有"明显在夸别人 + 最近跟我没什么互动"才冒一句，而且要冷却。

const OTHER = /(我朋友|我同事|我同学|我室友|前女友|前男友|别人|其他人|他朋友|她朋友)/
const WARM_ABOUT_OTHER = /(挺好的|很好|好可爱|真好|厉害|喜欢|开心|愉快|温柔)/
const COOLDOWN = 2 * 60 * 60 * 1000

/**
 * @param {{jealousy:number, lastLineAt:number}} state
 */
export function createPossess(state = {}) {
  const s = {
    jealousy: 0,
    lastLineAt: 0,
    hits: 0,
    ...state,
  }

  function note(text, at = Date.now()) {
    const t = String(text || '')
    // 只认"别人 + 正面评价"同时出现
    if (OTHER.test(t) && WARM_ABOUT_OTHER.test(t)) {
      s.jealousy = Math.min(1, s.jealousy + 0.25)
      s.hits += 1
      return true
    }
    return false
  }

  // 时间会冲淡：每过去一小时掉一点
  function decay(at = Date.now()) {
    if (!s.lastLineAt) return
    const hours = Math.max(0, (at - s.lastLineAt) / (60 * 60 * 1000))
    s.jealousy = Math.max(0, s.jealousy - hours * 0.15)
  }

  function line(at = Date.now()) {
    decay(at)
    if (s.jealousy < 0.5) return null
    if (at - s.lastLineAt < COOLDOWN) return null
    s.lastLineAt = at
    s.jealousy = Math.max(0, s.jealousy - 0.3) // 说出来就消一点，不积累成怨气
    return '他跟别人也这么热络啊……行吧'
  }

  const snapshot = () => ({
    jealousy: Number(s.jealousy.toFixed(3)),
    lastLineAt: s.lastLineAt,
    hits: s.hits,
  })
  const restore = (x) => {
    if (!x || typeof x !== 'object') return
    s.jealousy = Number(x.jealousy) || 0
    s.lastLineAt = Number(x.lastLineAt) || 0
    s.hits = Number(x.hits) || 0
  }

  return { note, line, snapshot, restore, decay }
}
