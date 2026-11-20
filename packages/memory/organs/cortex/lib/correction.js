// 人工纠错（F46、R21、R24）：用户说「记错了」→ 标错、保留历史、写审计。
// 不物理删除，证据链不断。
import { appendJsonl, FILES } from './store.js'
import { touch } from './schema.js'

export async function correct(store, id, { reason = 'user-said-wrong', by = 'user' } = {}) {
  const cell = store.get(id)
  if (!cell) return null
  touch(cell, {
    retracted: true,
    state: 'retracted',
    confidence: 0.05,
    biasFlag: false,
    tags: [...new Set([...(cell.tags || []), 'corrected'])],
  })
  store.put(cell)
  const row = {
    at: Date.now(),
    kind: 'correction',
    cellId: id,
    text: cell.text,
    reason,
    by,
  }
  await appendJsonl(FILES.audit, row)
  return { cellId: id, retracted: true, reason }
}
