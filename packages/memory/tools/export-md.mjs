// 把四器官的记忆导成一份人看的 md（只读视图）。
// 用法: node export-md.mjs [输出目录]
// 默认输出到 <hippocampus>/export/memory-YYYY-MM-DD.md

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { homedir } from 'node:os'

const HOME = homedir()
const 数据 = HOME + '/.dsh'
const HIPPO = join(数据, 'hippocampus')
const CORTEX = join(数据, 'cortex')

const outDir = process.argv[2] || join(HIPPO, 'export')

function readJsonl(path) {
  if (!existsSync(path)) return []
  const out = []
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    if (!line.trim()) continue
    try { out.push(JSON.parse(line)) } catch { /* 坏行跳过 */ }
  }
  return out
}

const fmtTime = (ms) => {
  if (!ms) return '?'
  const d = new Date(ms)
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

// ---- 事件 ----
const episodes = readJsonl(join(HIPPO, 'episodes.jsonl'))
// 同一个 id 只留最新版本
const epById = new Map()
for (const ep of episodes) {
  const old = epById.get(ep.id)
  if (!old || (ep.version || 1) >= (old.version || 1)) epById.set(ep.id, ep)
}
const epList = [...epById.values()].sort((a, b) => (a.start || 0) - (b.start || 0))

// ---- 知识 ----
const cells = readJsonl(join(CORTEX, 'cells.jsonl'))
const cellById = new Map()
for (const c of cells) {
  const old = cellById.get(c.id)
  if (!old || (c.version || 1) >= (old.version || 1)) cellById.set(c.id, c)
}
const cellList = [...cellById.values()]
  .filter((c) => c.state !== 'archived')
  .sort((a, b) => (a.predicate || '').localeCompare(b.predicate || ''))

// ---- 拼 md ----
const L = []
L.push(`# 记忆视图 · ${fmtTime(Date.now())}`)
L.push('')
L.push('> 这是从 jsonl 导出的**只读视图**。')
L.push('> 想改内容：改完告诉我，我按 id 走插件接口重新写入（会生成新版本，不覆盖旧记录）。')
L.push('> 直接改这里不会生效——下次导出会被覆盖。')
L.push('')
L.push(`- 事件 **${epList.length}** 条`)
L.push(`- 知识 **${cellList.length}** 条`)
L.push('')

L.push('---')
L.push('')
L.push('## 事件')
L.push('')
for (const ep of epList) {
  L.push(`### ${fmtTime(ep.start)}`)
  L.push('')
  L.push(`<!-- ${ep.id} -->`)
  L.push('')
  L.push(String(ep.summary || '').trim())
  L.push('')
  const 元 = []
  if (ep.depth) 元.push(`深度 ${ep.depth}`)
  if (typeof ep.salience === 'number') 元.push(`显著 ${ep.salience.toFixed(2)}`)
  if (typeof ep.accessibility === 'number') 元.push(`可及 ${ep.accessibility.toFixed(2)}`)
  if (ep.state) 元.push(`状态 ${ep.state}`)
  if (ep.type && ep.type !== '未知') 元.push(`类型 ${ep.type}`)
  if (元.length) L.push(`*${元.join(' · ')}*`)
  L.push('')
}

L.push('---')
L.push('')
L.push('## 知识')
L.push('')
let 当前谓词 = null
for (const c of cellList) {
  const pred = c.predicate || '(未分类)'
  if (pred !== 当前谓词) {
    L.push(`### ${pred}`)
    L.push('')
    当前谓词 = pred
  }
  L.push(`- <!-- ${c.id} --> ${String(c.text || c.object || '').trim()}`)
  const 元 = []
  if (c.kind) 元.push(c.kind)
  if (c.state) 元.push(c.state)
  if (typeof c.confidence === 'number') 元.push(`置信 ${c.confidence.toFixed(2)}`)
  if (元.length) L.push(`  *${元.join(' · ')}*`)
}
L.push('')

mkdirSync(outDir, { recursive: true })
const stamp = fmtTime(Date.now()).replace(/[: ]/g, '-')
const outPath = join(outDir, `memory-${stamp}.md`)
writeFileSync(outPath, L.join('\n'), 'utf8')

console.log(`导出 ${epList.length} 条事件 / ${cellList.length} 条知识`)
console.log(outPath)
