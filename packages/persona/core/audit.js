// S10 冲突自检：器官读数之间互相打架时，记进队列等复核，不硬解释、不装作没看见。
// 规格原文：「我家状态跟别的器官对不上时进队列」
import fs from 'node:fs'
import { dirname, join } from 'node:path'

// 互相矛盾的组合：两条都高时，至少有一条不成立
const PAIRS = [
  {
    id: 'warm-vs-offense',
    a: (r) => Number(r.ofc && r.ofc.warm) || 0,
    b: (r) => Number(r.tpj && r.tpj.offense) || 0,
    at: 0.5,
    why: '又被暖到又被冒犯：可能是同一句话里既有善意又有刺，也可能读数错了',
  },
  {
    id: 'want-vs-satiation',
    a: (r) => Number(r.str && r.str.wanting) || 0,
    b: (r) => Number(r.str && r.str.satiation) || 0,
    at: 0.55,
    why: '又很想要又已经腻了：通常是话题换了但状态没跟上',
  },
  {
    id: 'esteem-vs-pride',
    a: (r) => 1 - (Number(r.mpfc && r.mpfc.esteem) || 0.5),
    b: (r) => Number(r.ofc && r.ofc.pride) || 0,
    at: 0.5,
    why: '低自尊同时又骄傲：两个自我评价方向相反',
  },
]

export function detectConflicts(reads = {}) {
  const found = []
  for (const p of PAIRS) {
    let a = 0
    let b = 0
    try { a = p.a(reads) } catch { a = 0 }
    try { b = p.b(reads) } catch { b = 0 }
    if (a >= p.at && b >= p.at) found.push({ id: p.id, a: Number(a.toFixed(3)), b: Number(b.toFixed(3)), why: p.why })
  }
  return found
}

export function createConflictLog(file) {
  const read = () => {
    try {
      const arr = JSON.parse(fs.readFileSync(file, 'utf8'))
      return Array.isArray(arr) ? arr : []
    } catch { return [] }
  }

  function note(conflicts, at = Date.now()) {
    if (!Array.isArray(conflicts) || !conflicts.length) return []
    const list = read()
    // 同一个组合 10 分钟内不重复记，避免每拍刷一条
    const fresh = conflicts.filter((c) => !list.some((x) => x.id === c.id && at - x.at < 10 * 60 * 1000))
    if (!fresh.length) return []
    for (const c of fresh) list.push({ ...c, at })
    try {
      fs.mkdirSync(dirname(file), { recursive: true })
      fs.writeFileSync(file, JSON.stringify(list.slice(-200)), 'utf8')
    } catch { /* 写不了不影响主流程 */ }
    return fresh
  }

  const count = () => read().length

  return { note, count, read }
}
