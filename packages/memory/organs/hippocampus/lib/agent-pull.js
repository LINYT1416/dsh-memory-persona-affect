// 从 agent 的 session.surface 里拉对话。
//
// 真实形状（从磁盘上的 session_projcache 反推，不是猜的）：
//   node.val.turns = [ { turn, seq, prompt, response }, ... ]
// 一条 turn 就是一轮：prompt 是她说的，response 是我说的。
//
// 两个坑都在这里被修掉了：
//   1. 以前按事件形状 source.type === 'user/message' 找，投影里根本没有这个字段
//   2. 游标按 agent.id 记，而 agent.id 每次 tick 都在变 → 每次都被当成"首次见到"→ 永远只对齐、不写入
import fs from 'node:fs'

const CURSOR_FILE = 'C:/Users/64091/.dsh/hippocampus/_pull-cursors.json'

/** 游标落盘：重启不丢，也不会把停机期间的轮次当历史吞掉 */
export function loadCursors(file = CURSOR_FILE) {
  const map = new Map()
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'))
    for (const [k, v] of Object.entries(raw)) map.set(k, Number(v) || 0)
  } catch { /* 没有就当空 */ }
  return map
}

export function saveCursors(map, file = CURSOR_FILE) {
  try {
    const obj = {}
    for (const [k, v] of map) obj[k] = v
    fs.writeFileSync(file, JSON.stringify(obj))
  } catch { /* 写不进下次再说 */ }
}

/** 会话的稳定键：session id 优先，agent.id 最后兜底 */
export function sessionKeyOf(agent) {
  return String(agent?.session?.header?.id || agent?.session?.id || agent?.id || 'agent')
}

/** 从任意节点里收集 turns */
export function collectTurns(nodes = []) {
  const out = []
  for (const node of nodes) {
    const turns = node?.val?.turns ?? node?.turns
    if (!Array.isArray(turns)) continue
    for (const t of turns) {
      if (!t || typeof t !== 'object') continue
      const seq = Number(t.seq ?? t.turn ?? 0)
      const prompt = typeof t.prompt === 'string' ? t.prompt.trim() : ''
      const response = typeof t.response === 'string' ? t.response.trim() : ''
      if (prompt) out.push({ role: 'user', text: prompt, seq })
      if (response) out.push({ role: 'assistant', text: response, seq: seq + 0.5 })
    }
  }
  return out.sort((a, b) => a.seq - b.seq)
}

/** 取比 cursor 新的消息；next 是新的游标（最大 seq） */
export function pullNew(nodes = [], cursor = 0, { max = 40 } = {}) {
  const all = collectTurns(nodes)
  const fresh = all.filter((m) => Number(m.seq) > Number(cursor || 0))
  const items = fresh.slice(0, max)
  const next = all.length ? Math.max(Number(cursor || 0), ...all.map((m) => m.seq)) : Number(cursor || 0)
  return { items, next }
}

/**
 * 拉一轮。首见某个会话只对齐游标、不补历史（一个会话可能有几百轮）。
 * diag 用来让调用方把"看到了什么"写进日志，避免再次靠猜。
 */
export async function pullAgents(agents = [], cursors = new Map(), onItem, diag = null) {
  const detail = []
  for (const agent of agents) {
    try {
      const id = sessionKeyOf(agent)
      const nodes = agent?.session?.surface?.nodes
      if (!Array.isArray(nodes) || !nodes.length) { detail.push({ id, turns: 0 }); continue }
      const first = !cursors.has(id)
      const cur = cursors.get(id) || 0
      const { items, next } = pullNew(nodes, cur)
      cursors.set(id, next)
      detail.push({ id: id.slice(0, 12), turns: collectTurns(nodes).length, cur, first, fresh: items.length })
      if (first) continue
      for (const it of items) await onItem({ ...it, sessionId: id })
    } catch (e) {
      detail.push({ id: 'err', error: String(e?.message || e) })
    }
  }
  diag?.(detail)
  return detail
}
