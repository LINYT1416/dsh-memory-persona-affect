// 自检：现在缓存里有什么、游标在哪、还差几条没进记忆。
// 用法：node tools/pull-check.mjs
import { recentCacheFiles, turnsOfCache, loadCursors } from '../organs/hippocampus/lib/session-cache.js'
import fs from 'node:fs'

const cursors = loadCursors('C:/Users/64091/.dsh/hippocampus/_cache-cursors.json')
const files = recentCacheFiles()

let totalTurns = 0
let pending = 0
const rows = []
for (const f of files) {
  const turns = turnsOfCache(f.file)
  totalTurns += turns.length
  const cur = cursors.get(f.name)
  const maxSeq = turns.length ? Math.max(...turns.map((t) => t.seq)) : 0
  const fresh = cur === undefined ? '首次(未对齐)' : turns.filter((t) => t.seq > cur).length
  if (typeof fresh === 'number') pending += fresh
  rows.push({ name: f.name.slice(0, 22), turns: turns.length, cur: cur ?? '-', maxSeq, fresh })
}

rows.sort((a, b) => b.turns - a.turns)
console.log('缓存文件:', files.length, '| 总轮次:', totalTurns)
console.log('待写入 (游标之后):', pending)
console.log('')
console.log('会话'.padEnd(24), '轮次'.padStart(6), '游标'.padStart(10), '最新seq'.padStart(10), '待写'.padStart(6))
for (const r of rows.slice(0, 8)) {
  console.log(String(r.name).padEnd(24), String(r.turns).padStart(6), String(r.cur).padStart(10), String(r.maxSeq).padStart(10), String(r.fresh).padStart(6))
}

// 记忆侧：raw 今天写进去多少条、最后一条是什么
const day = new Date().toISOString().slice(0, 10)
const rawFile = `C:/Users/64091/.dsh/hippocampus/raw/raw-${day}.jsonl`
if (fs.existsSync(rawFile)) {
  const lines = fs.readFileSync(rawFile, 'utf8').split('\n').filter(Boolean)
  console.log('\n今天写进海马体:', lines.length, '条')
  const last = lines.slice(-3).map((l) => {
    try { const o = JSON.parse(l); return `${o.role}:${String(o.text).slice(0, 26)}` } catch { return '?' }
  })
  for (const l of last) console.log('   ', l)
}
