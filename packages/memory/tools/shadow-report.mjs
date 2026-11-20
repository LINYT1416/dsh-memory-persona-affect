// 影子报告：现判定 vs 严判定（三元指纹）差多少。
// 用法：node tools/shadow-report.mjs [天数，默认 7]
import fs from 'node:fs'
import path from 'node:path'

const dir = 'C:/Users/64091/.dsh/hippocampus'
const days = Number(process.argv[2] || 7)
const file = path.join(dir, 'shadow.log')

if (!fs.existsSync(file)) {
  console.log('还没有影子日志（shadow.log 不存在）。它会在新消息进来时逐条生成。')
  process.exit(0)
}

const since = Date.now() - days * 24 * 3600 * 1000
const rows = []
for (const l of fs.readFileSync(file, 'utf8').split('\n').filter(Boolean)) {
  try {
    const o = JSON.parse(l)
    if (Number(o.at) >= since) rows.push(o)
  } catch { /* 坏行跳过 */ }
}

if (!rows.length) {
  console.log(`最近 ${days} 天没有影子记录。`)
  process.exit(0)
}

let agree = 0
const cases = { currentSame_shadowDistinct: 0, currentDistinct_shadowSame: 0, bothSame: 0, bothDistinct: 0 }
for (const r of rows) {
  const c = r.current === 'same' || r.current === 'duplicate'
  const s = r.shadow === 'same'
  if (c && s) cases.bothSame++
  else if (!c && !s) cases.bothDistinct++
  else if (c && !s) cases.currentSame_shadowDistinct++
  else cases.currentDistinct_shadowSame++
  if (c === s) agree++
}

const pct = (n) => ((n / rows.length) * 100).toFixed(1) + '%'
console.log(`窗口：最近 ${days} 天，共 ${rows.length} 条`)
console.log(`一致：${agree}（${pct(agree)}）`)
console.log(`现判定"并进一段"、严判定"新开一段"：${cases.currentSame_shadowDistinct}（${pct(cases.currentSame_shadowDistinct)}）  ← 收紧后会多出这么多条记忆`)
console.log(`现判定"新开"、严判定"并进"：${cases.currentDistinct_shadowSame}（${pct(cases.currentDistinct_shadowSame)}）`)
console.log(`两边都判 same：${cases.bothSame}（${pct(cases.bothSame)}）`)
console.log(`两边都判 distinct：${cases.bothDistinct}（${pct(cases.bothDistinct)}）`)

const examples = rows.filter((r) => (r.current === 'same' || r.current === 'duplicate') && r.shadow !== 'same').slice(-5)
if (examples.length) {
  console.log('\n会被收紧拆开的例子：')
  for (const e of examples) console.log(`  ${e.text}  | score=${e.score} who=${(e.who || []).join('+')} where=${e.where || '-'} what=${e.what || '-'}`)
}
