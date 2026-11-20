// 覆盖率检查：拿功能总表里的 ID，和代码里声明的 cover 对账。
//   node tests/coverage.mjs "~\Desktop\情绪插件-功能总表.md"
// 表里标"免"的条目算豁免（有消融理由），不计入缺口。
import { readFileSync, existsSync } from 'node:fs'
import { createEngine } from '../core/engine.js'

const CANDIDATES = [
  process.argv[2],
  'E:\\heart\\docs\\功能总表.md',
  'C:\\Users\\64091\\Desktop\\情绪插件-功能总表.md',
].filter(Boolean)

const tablePath = CANDIDATES.find(p => existsSync(p))
if (!tablePath) {
  console.error('找不到功能总表。试过：\n  ' + CANDIDATES.join('\n  '))
  console.error('\n覆盖率是对着总表数的，表不在就没法核。把表放回任一路径再跑。')
  process.exit(2)
}

const text = readFileSync(tablePath, 'utf8')
const lines = text.split(/\r?\n/)
let section = ''
const table = []
for (const l of lines) {
  if (/^## /.test(l)) section = l.replace(/^## /, '').trim()
  const m = l.match(/^\|\s*([A-Z]\d{2})\s*\|/)
  if (!m) continue
  const cells = l.split('|').map(s => s.trim())
  const ci = cells.findIndex(c => ['全', '简', '免'].includes(c))
  table.push({ id: m[1], section: section.replace(/（.*$/, '').trim(), exempt: ci >= 0 && cells[ci] === '免' })
}

const engine = createEngine()
const implemented = new Set(Object.values(engine.cover()).flat())

const bySection = {}
for (const row of table) {
  bySection[row.section] = bySection[row.section] || { total: 0, done: 0, exempt: 0, missing: [] }
  const s = bySection[row.section]
  s.total += 1
  if (row.exempt) { s.exempt += 1; s.done += 1 }
  else if (implemented.has(row.id)) s.done += 1
  else s.missing.push(row.id)
}

let total = 0, done = 0
console.log('表'.padEnd(30), '覆盖'.padStart(8), '  缺口')
for (const [k, v] of Object.entries(bySection)) {
  total += v.total; done += v.done
  console.log(k.padEnd(30), `${v.done}/${v.total}`.padStart(8), v.missing.length ? '  缺: ' + v.missing.join(',') : '  完整')
}
console.log('─'.repeat(72))
console.log('合计'.padEnd(30), `${done}/${total}`.padStart(8), `  ${Math.round(done / total * 100)}%`)

const orphan = [...implemented].filter(id => !table.find(t => t.id === id))
if (orphan.length) console.log('\n代码里声明了但表里没有的 ID：', orphan.join(', '))
process.exit(done === total ? 0 : 1)
