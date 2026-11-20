// 干跑：从 DSH 会话投影缓存里把消息捞出来，看看能拿到什么。
// 只读，不写任何东西。先把"能捞到什么"看清楚，再决定要不要接进海马体。
import fs from 'node:fs'
import path from 'node:path'

const dir = 'C:/Users/64091/.dsh/storages/session_projcache/sessions'
const files = fs
  .readdirSync(dir)
  .filter((f) => f.endsWith('.json'))
  .map((f) => ({ f, t: fs.statSync(path.join(dir, f)).mtimeMs }))
  .sort((a, b) => b.t - a.t)

function textOf(row) {
  if (!row) return ''
  if (typeof row === 'string') return row
  const c = [row.text, row.content, row.body, row.message?.text, row.message?.content, row.value]
  for (const v of c) {
    if (typeof v === 'string' && v.trim()) return v.trim()
    if (Array.isArray(v)) {
      const joined = v.map((p) => (typeof p === 'string' ? p : p?.text || p?.content || '')).join('').trim()
      if (joined) return joined
    }
  }
  return ''
}

function eachRow(rows) {
  if (!rows) return []
  if (Array.isArray(rows)) return rows
  if (typeof rows === 'object') return Object.values(rows)
  return []
}

for (const { f } of files.slice(0, 2)) {
  const j = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'))
  const rows = eachRow(j?.record?.rows)
  console.log('=== ' + f.slice(0, 24) + '… rows=' + rows.length + ' ===')
  const sample = rows.slice(-2)
  for (const r of sample) {
    console.log('  keys:', Object.keys(r || {}).join(','))
    console.log('  text:', JSON.stringify(textOf(r)).slice(0, 140))
  }
  const msgs = rows.map((r) => ({ role: r?.role || r?.kind || r?.type || '?', text: textOf(r) })).filter((m) => m.text)
  console.log('  可提取消息:', msgs.length, '| 角色分布:', JSON.stringify(msgs.reduce((m, x) => { m[x.role] = (m[x.role] || 0) + 1; return m }, {})))
  if (msgs.length) console.log('  最后一条:', JSON.stringify(msgs[msgs.length - 1]).slice(0, 200))
}
