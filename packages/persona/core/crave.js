// H03 渴求与上瘾：同一个东西反复想，会变成"有点忍不住"。
// 只认少数几类会成瘾的东西；计数有窗口，过时就淡。

const TOPICS = [
  { key: 'coffee', re: /(咖啡|美式|拿铁|浓缩)/, line: '又想去买咖啡了' },
  { key: 'milk-tea', re: /(奶茶|珍珠)/, line: '又想喝奶茶了，忍忍' },
  { key: 'phone', re: /(刷手机|刷视频|刷 B 站|刷B站|短视频)/, line: '手又痒了，想刷一会儿' },
  { key: 'game', re: /(打游戏|开黑|排位|上分)/, line: '有点想开一局' },
  { key: 'sweet', re: /(甜食|蛋糕|冰淇淋|冰激凌|巧克力)/, line: '想吃点甜的' },
]

const WINDOW = 2 * 60 * 60 * 1000   // 两小时内算同一次瘾头
const THRESHOLD = 3                  // 提三次才承认
const COOLDOWN = 3 * 60 * 60 * 1000

export function createCrave(state = {}) {
  const s = { counts: {}, lastAt: 0, saidAt: 0, ...state }

  function note(text, at = Date.now()) {
    const t = String(text || '')
    let hit = null
    for (const x of TOPICS) {
      if (x.re.test(t)) { hit = x; break }
    }
    if (!hit) return { hit: false, key: null, count: 0 }

    // 窗口外的旧计数先清掉
    const prev = s.counts[hit.key]
    if (!prev || at - prev.last > WINDOW) s.counts[hit.key] = { n: 1, last: at }
    else s.counts[hit.key] = { n: prev.n + 1, last: at }

    return { hit: true, key: hit.key, count: s.counts[hit.key].n }
  }

  function line(at = Date.now()) {
    if (at - s.saidAt < COOLDOWN) return null
    for (const x of TOPICS) {
      const c = s.counts[x.key]
      if (c && c.n >= THRESHOLD && at - c.last <= WINDOW) {
        s.saidAt = at
        s.counts[x.key] = { n: 1, last: at }   // 说出来就清账，别一直念
        return x.line
      }
    }
    return null
  }

  const snapshot = () => ({ counts: JSON.parse(JSON.stringify(s.counts)), saidAt: s.saidAt })
  const restore = (x) => {
    if (!x || typeof x !== 'object') return
    s.counts = x.counts && typeof x.counts === 'object' ? x.counts : {}
    s.saidAt = Number(x.saidAt) || 0
  }

  return { note, line, snapshot, restore }
}
