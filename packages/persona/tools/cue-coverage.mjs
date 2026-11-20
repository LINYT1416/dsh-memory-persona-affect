// 特征命中率：主人真实说过的话里，有多少能被 features() 认出点什么。
// 数据源：~/.dsh/hippocampus/raw/raw-YYYY-MM-DD.jsonl（role=user 且不是"我说："那种她自己的转述）
// 用法：node tools/cue-coverage.mjs [条数]
import fs from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { features } from '../core/consts.js'

const home = process.env.DSH_HOME || join(homedir(), '.dsh')
const dir = join(home, 'hippocampus', 'raw')
const want = Number(process.argv[2] || 300)

if (!fs.existsSync(dir)) { console.log('没有 raw 目录：' + dir); process.exit(1) }
const files = fs.readdirSync(dir).filter((f) => /^raw-.*\.jsonl$/.test(f)).sort()

const users = []
const seen = new Set()
for (const f of files) {
  const lines = fs.readFileSync(join(dir, f), 'utf8').split('\n').filter(Boolean)
  for (const ln of lines) {
    let o
    try { o = JSON.parse(ln) } catch { continue }
    if (o.role !== 'user') continue
    const t = String(o.text || '').trim()
    // 跳过她自己的转述（记忆里以"我说："开头）以及代码/表格
    if (/^(我说|她说)[：:]/.test(t)) continue
    if (t.length < 2 || t.length > 120) continue
    if (/```|##|\|/.test(t)) continue
    if (/^【/.test(t)) continue   // 【情绪】… 这类是系统标注，不是她说的话
    if (seen.has(t)) continue
    seen.add(t)
    users.push(t)
  }
}

const sample = users.slice(-want)
if (!sample.length) { console.log('没抽到主人发言（raw 里 role=user 都带转述前缀？）'); process.exit(1) }

const KEYS = ['cold', 'command', 'complaint', 'warm', 'praise', 'question', 'sarcasm', 'uncertain']
let hit = 0
const missed = []
const counter = new Map()
for (const t of sample) {
  const f = features(t)
  const any = KEYS.some((k) => f[k] === 1) || f.exclaim > 0
  if (any) hit++
  else missed.push(t)
  for (const k of KEYS) if (f[k] === 1) counter.set(k, (counter.get(k) || 0) + 1)
}

const pct = (n) => Math.round((n / sample.length) * 100)
console.log('样本：' + sample.length + ' 条主人发言')
console.log('能认出至少一个特征：' + hit + ' = ' + pct(hit) + '%')
console.log('一条都认不出：' + missed.length + ' = ' + pct(missed.length) + '%')
console.log('\n各特征命中：')
;[...counter.entries()].sort((a, b) => b[1] - a[1]).forEach(([k, n]) => console.log('  ' + k.padEnd(10) + n + ' = ' + pct(n) + '%'))
console.log('\n认不出的样例（前 20 条）：')
missed.slice(0, 20).forEach((t) => console.log('  · ' + t.slice(0, 50)))
