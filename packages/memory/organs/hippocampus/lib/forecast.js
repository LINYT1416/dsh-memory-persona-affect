// 未来推演：不是预言，是从已有记忆里推"接下来大概会发生什么"。
// 只给两种可解释的推演，不猜别的：
//   1) 未兑现的计划（你说过要做的，后来没见做）
//   2) 时段习惯（同一个时段，最近反复在做同一类事）
// 每条都带依据（哪几条 episode），没有依据就不输出 —— 宁可空着，不编。

const DAY = 24 * 60 * 60 * 1000
const PLAN = /(打算|准备|决定|要|得|想|会)(去|做|弄|改|写|看|吃|买|睡|起|上班|下班|回家|出门)|明天|后天|下周|周末|等会儿?|待会儿?/
const DONE = /(已经|刚|做完了|搞定了|完成|做好了|吃过了|看完了|睡了|到了)/

function hourOf(ts) {
  return new Date(Number(ts)).getHours()
}

/** 未兑现的计划：最近说过要做，但之后没出现"做完了"的信号 */
export function pendingPlans(episodes = [], { now = Date.now(), lookbackMs = 3 * DAY } = {}) {
  const out = []
  for (const ep of episodes) {
    const at = Number(ep.start || 0)
    if (now - at > lookbackMs) continue
    const text = String(ep.summary || ep.text || '')
    if (!PLAN.test(text)) continue
    if (DONE.test(text)) continue
    // 后面出现了"做完了"的信号，而且跟这条计划是同一件事（实体有重叠）→ 视为已兑现，不推
    const ents = ep.entities || []
    const later = episodes.filter((x) => {
      if (Number(x.start || 0) <= at) return false
      const t = String(x.summary || x.text || '')
      if (!DONE.test(t)) return false
      if (!ents.length) return t.includes(text.slice(0, 6))
      return (x.entities || []).some((e) => ents.includes(e))
    })
    if (later.length) continue
    out.push({
      kind: 'plan',
      text,
      basis: [ep.id],
      confidence: 0.5,
      why: '你说过要做，之后没见做',
    })
  }
  // 去重：同一句话可能被拆成两条 episode（分段造成），只留最后一条
  const seen = new Set()
  const dedup = []
  for (const x of out.reverse()) {
    const key = String(x.text).replace(/\s+/g, '').slice(0, 12)
    if (seen.has(key)) continue
    seen.add(key)
    dedup.push(x)
  }
  return dedup.reverse().slice(-3)
}

/** 时段习惯：同一个三小时窗口里，最近反复出现同一类事件 */
export function routinePatterns(episodes = [], { now = Date.now(), windowDays = 7, minCount = 3 } = {}) {
  const buckets = new Map()
  const BAD_TYPE = new Set(['', '未知', 'unknown', '其他'])
  for (const ep of episodes) {
    const at = Number(ep.start || 0)
    if (now - at > windowDays * DAY) continue
    if (BAD_TYPE.has(String(ep.type || ''))) continue
    const key = `${Math.floor(hourOf(at) / 3)}|${ep.type || 'event'}`
    if (!buckets.has(key)) buckets.set(key, [])
    buckets.get(key).push(ep)
  }
  const out = []
  for (const [key, list] of buckets) {
    if (list.length < minCount) continue
    const [bucket] = key.split('|')
    const from = Number(bucket) * 3
    out.push({
      kind: 'routine',
      text: `${from} 点到 ${from + 3} 点之间，你常在:${list[0].type || 'event'}`,
      basis: list.slice(-3).map((x) => x.id),
      confidence: Math.min(0.8, 0.4 + 0.1 * list.length),
      why: `最近 ${windowDays} 天这个时段出现 ${list.length} 次`,
    })
  }
  return out.sort((a, b) => b.confidence - a.confidence).slice(0, 3)
}

export function forecast(episodes = [], opts = {}) {
  return [...pendingPlans(episodes, opts), ...routinePatterns(episodes, opts)]
}

/** 给注入用的一句话 */
export function forecastLine(items = []) {
  if (!items.length) return ''
  const top = items.slice(0, 2).map((x) => x.text).join('；')
  return `可能接着：${top}`
}
