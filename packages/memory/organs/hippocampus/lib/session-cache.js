// 从 DSH 的会话投影缓存里读对话，**一轮一条**。
//
// 为什么按轮：单条消息太短，编码门会判成 shallow（不值得记），于是永远进不了 episode，
// 巩固没料可吃，皮层也就没记忆。一轮的长度才够，这也正好是主人要的"咱俩一轮对话记成一条"。
import fs from 'node:fs'
import path from 'node:path'

export const CACHE_DIR = 'C:/Users/64091/.dsh/storages/session_projcache/sessions'
const CURSOR_FILE = 'C:/Users/64091/.dsh/hippocampus/_cache-cursors.json'

export function loadCursors(file = CURSOR_FILE) {
  const map = new Map()
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'))
    for (const [k, v] of Object.entries(raw)) map.set(k, Number(v) || 0)
  } catch { /* 空 */ }
  return map
}

export function saveCursors(map, file = CURSOR_FILE) {
  try {
    const obj = {}
    for (const [k, v] of map) obj[k] = v
    fs.writeFileSync(file, JSON.stringify(obj))
  } catch { /* 下次再说 */ }
}

/** 从一个 cache 文件里取出所有轮次（原始结构） */
export function turnsOfCache(file) {
  let json
  try {
    json = JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch {
    return []
  }
  const rows = json?.record?.rows
  if (!rows) return []
  const out = []
  for (const row of Object.values(rows)) {
    const turns = row?.val?.turns
    if (!Array.isArray(turns)) continue
    for (const t of turns) {
      if (!t || typeof t !== 'object') continue
      const seq = Number(t.seq ?? t.turn ?? 0)
      const prompt = typeof t.prompt === 'string' ? t.prompt.trim() : ''
      const response = typeof t.response === 'string' ? t.response.trim() : ''
      if (!prompt && !response) continue
      out.push({ seq, turn: Number(t.turn ?? 0), prompt, response })
    }
  }
  return out.sort((a, b) => a.seq - b.seq)
}

/** 把一轮拼成一条记忆文本 */
export function turnToItem(t) {
  const said = t.prompt ? `她说：${t.prompt}` : ''
  const mine = t.response ? `我说：${t.response}` : ''
  const text = [said, mine].filter(Boolean).join('\n')
  return { role: 'user', text, seq: t.seq, turn: t.turn, channel: 'cache-turn' }
}

export function recentCacheFiles(dir = CACHE_DIR, { maxAgeMs = 3 * 24 * 3600 * 1000, now = Date.now() } = {}) {
  try {
    return fs
      .readdirSync(dir)
      .filter((f) => f.endsWith('.json'))
      .map((f) => ({ file: path.join(dir, f), name: f, mtime: fs.statSync(path.join(dir, f)).mtimeMs }))
      .filter((x) => now - x.mtime < maxAgeMs)
      .sort((a, b) => b.mtime - a.mtime)
  } catch {
    return []
  }
}

/**
 * 拉一轮：每个缓存文件一个游标；首次见到只对齐、不补历史。
 * 一条 item = 一轮（她说的 + 我说的），不是两条独立消息。
 */
export async function pullFromCache(files, cursors, onItem, { max = 40 } = {}) {
  const detail = []
  for (const { file, name } of files) {
    const turns = turnsOfCache(file)
    if (!turns.length) { detail.push({ name: name.slice(0, 20), turns: 0 }); continue }
    const maxSeq = Math.max(...turns.map((t) => t.seq))
    const first = !cursors.has(name)
    const cur = cursors.get(name) || 0
    if (first) {
      cursors.set(name, maxSeq)
      detail.push({ name: name.slice(0, 20), turns: turns.length, first: true })
      continue
    }
    const fresh = turns.filter((t) => t.seq > cur).slice(0, max)
    if (fresh.length) cursors.set(name, Math.max(cur, ...fresh.map((t) => t.seq)))
    detail.push({ name: name.slice(0, 20), turns: turns.length, cur, fresh: fresh.length })
    for (const t of fresh) await onItem({ ...turnToItem(t), sessionId: name })
  }
  return detail
}
