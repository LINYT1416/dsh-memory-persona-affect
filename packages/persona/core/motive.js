// U01 不可及的动机：被问"为什么"时，她自己也说不清——但只有心里真惦记着件事才成立。
// 判据：必须先有"她惦记的事"（pending），且那件事没有记下为什么。

const WHY = /(为什么|为啥|干嘛要|怎么想起|图什么)/

/**
 * @param {object} goals {pending: Array<{text, why?}>}
 * @param {string} text 对方的话
 */
export function opaqueMotive(goals = {}, text = '') {
  const t = String(text || '')
  if (!WHY.test(t)) return { opaque: false, line: null, because: 'not-asked' }

  const pending = Array.isArray(goals.pending) ? goals.pending : []
  if (!pending.length) return { opaque: false, line: null, because: 'nothing-pending' }

  // 有件事是她自己都没写清"为什么"的
  const unexplained = pending.filter((g) => g && !String(g.why || '').trim())
  if (!unexplained.length) return { opaque: false, line: null, because: 'has-reason' }

  return { opaque: true, line: '也说不上为什么，就是心里一直惦记着', because: 'unexplained' }
}
