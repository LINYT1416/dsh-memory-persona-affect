// #P0-7 任务栈 / #P0-8 完成判据 / #P0-9 目标过期 / #P0-10 规则维持
// 规矩（R1）：未完成任务是唯一"不许被丢弃"的保护；过期只降级，不删。
import { readJsonl, appendJsonl, rewriteJsonl, tail } from './jsonl.js'
import { FILES } from './paths.js'
import { constraintOf } from '../kernel/gate.js'

const DONE_WORDS = /搞定了|做完了|写完了|弄完了|弄好了|完成了|好了|解决了|不用了|算了|搞完|弄完/
const EXPIRE_MS = 6 * 3600 * 1000

let rows = null
let loading = null

/** 并发安全懒加载：缓存的是"正在读"的 promise，不是读到的结果。 */
export async function load() {
  if (!rows) {
    if (!loading) {
      loading = readJsonl(FILES.tasks).then((r) => {
        rows ||= r
        return rows
      })
    }
    await loading
  }
  return rows
}

/**
 * 完成判据（#P0-8）：没有判据的任务永远不算完成——这是 R1 的另一半。
 * 判据 = 有完成词 + 完成句里提到目标（2-gram 级，中文没空格不能按词比）。
 */
export function isDone(row, text = '') {
  if (!row) return false
  const t = String(text || '')
  if (row.doneCriteria && new RegExp(row.doneCriteria).test(t)) return true
  if (!DONE_WORDS.test(t)) return false
  const goal = String(row.goal || '')
  if (!goal) return false
  if (goal.length <= 2) return t.includes(goal)
  for (let i = 0; i < goal.length - 1; i += 1) {
    const g = goal.slice(i, i + 2)
    if (t.includes(g)) return true
  }
  return false
}

export async function push({ session, goal, doneCriteria = null, rules = [] }, now = Date.now()) {
  await load()
  const row = {
    id: `t-${now.toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    session: String(session || 'default'),
    goal: String(goal || '').slice(0, 120),
    state: 'open',
    createdAt: now,
    updatedAt: now,
    doneCriteria,
    rules: rules.filter(Boolean).slice(0, 6),
  }
  rows.push(row)
  await appendJsonl(FILES.tasks, row)
  return row
}

export async function list(session, { open = false } = {}) {
  await load()
  return rows.filter((r) => (!session || r.session === String(session)) && (!open || r.state === 'open'))
}

export function current(session) {
  const open = rows?.filter((r) => r.session === String(session) && r.state === 'open') || []
  return open[open.length - 1] || null
}

export async function pop(id, { text = '', now = Date.now() } = {}) {
  await load()
  const row = rows.find((r) => r.id === id)
  if (!row) return { ok: false, why: '没有这个任务' }
  if (!isDone(row, text)) return { ok: false, why: '判据没满足，不出栈' }
  row.state = 'done'
  row.updatedAt = now
  await rewriteJsonl(FILES.tasks, tail(rows, 800))
  return { ok: true, row }
}

/**
 * 过期（#P0-9）：超 6 小时不删，降级成 stale。
 * 静默丢目标是最糟的失败——用户会以为她记得。
 */
export async function expire(now = Date.now(), { ttl = EXPIRE_MS } = {}) {
  await load()
  const stale = []
  for (const r of rows) {
    if (r.state !== 'open') continue
    if (now - r.updatedAt < ttl) continue
    r.state = 'stale'
    r.updatedAt = now
    stale.push(r.id)
  }
  if (stale.length) await rewriteJsonl(FILES.tasks, tail(rows, 800))
  return { stale, count: stale.length }
}

/** 从一句用户话里抽约束，挂到当前任务上（#P0-10）。 */
export async function absorbConstraint(session, text, now = Date.now()) {
  const c = constraintOf(text)
  if (!c) return null
  await load()
  const row = current(session)
  if (!row) return null
  row.rules = [...(row.rules || []), c.text].slice(-6)
  row.updatedAt = now
  await rewriteJsonl(FILES.tasks, tail(rows, 800))
  return c
}

export function rulesOf(session) {
  const row = current(session)
  return row?.rules || []
}

export function reset() {
  loading = null
  rows = null
}
