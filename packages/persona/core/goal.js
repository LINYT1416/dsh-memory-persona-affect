// M11 目标结果：她说要做的事，后来成了、黄了，还是还悬着。
// 规格原文：「目标结果：成了、黄了、还悬着」
const HOUR = 60 * 60 * 1000

// 她说要做的事：只认明确的"打算"，不把随口一句"我想吃火锅"当成目标
const INTENT = /(打算|准备|计划|要)(去|做|学|写|改|修|练|背|读|攒|办)\S*/
const DONE = /(做完了|搞定了|成了|过了|通过了|写完了|改好了|修好了|背完了|拿到了)/
const FAILED = /(黄了|没成|失败了|没过|没做完|来不及|放弃了|算了不|不去了)/

export function createGoals(state = {}) {
  const s = {
    pending: [],   // 还悬着的：{ text, at }
    done: 0,
    failed: 0,
    lastOutcomeAt: 0,
    ...state,
  }

  function note(text, at = Date.now()) {
    const t = String(text || '')
    let changed = false

    if (DONE.test(t) && s.pending.length) {
      s.pending.pop()
      s.done += 1
      s.lastOutcomeAt = at
      changed = true
    } else if (FAILED.test(t) && s.pending.length) {
      s.pending.pop()
      s.failed += 1
      s.lastOutcomeAt = at
      changed = true
    } else if (INTENT.test(t) && t.length <= 60) {
      // 同一句话不重复记；最多留 5 条
      if (!s.pending.some((g) => g.text === t)) {
        s.pending.push({ text: t, at })
        if (s.pending.length > 5) s.pending.shift()
        changed = true
      }
    }
    return { changed, pending: s.pending.length, done: s.done, failed: s.failed }
  }

  // 只有"悬太久"或"刚有结果"才说一句
  function line(now = Date.now()) {
    const stale = s.pending.find((g) => now - g.at > 6 * HOUR)
    if (stale) return `说好要「${stale.text.slice(0, 12)}」的，还悬着`
    if (s.lastOutcomeAt && now - s.lastOutcomeAt < 5 * 60 * 1000) {
      if (s.done > 0) return '答应过的事，办成了'
      if (s.failed > 0) return '那事没成，先记着'
    }
    return null
  }

  const snapshot = () => ({
    pending: s.pending.slice(-5).map((g) => ({ text: g.text.slice(0, 40), at: g.at })),
    done: s.done,
    failed: s.failed,
    lastOutcomeAt: s.lastOutcomeAt,
  })

  const restore = (x) => {
    if (!x || typeof x !== 'object') return
    if (Array.isArray(x.pending)) s.pending = x.pending.map((g) => ({ text: String(g.text || ''), at: Number(g.at) || 0 }))
    s.done = Number(x.done) || 0
    s.failed = Number(x.failed) || 0
    s.lastOutcomeAt = Number(x.lastOutcomeAt) || 0
  }

  return { note, line, snapshot, restore }
}
