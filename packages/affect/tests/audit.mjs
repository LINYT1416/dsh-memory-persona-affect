// 功能自检：对每个模块的源码做静态审计。
//   1) 声明了 cover，但源码里找不到对应 ID 的标记 → 疑似空壳
//   2) 源码里标了 ID，但没写进 cover → 漏声明
// 标记写法：在实现该条的行尾写 // A15
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, basename, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createEngine } from '../core/engine.js'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

function walk(dir, out = []) {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f)
    const st = statSync(p)
    if (st.isDirectory()) { if (f !== 'tests' && f !== 'node_modules') walk(p, out) }
    else if (f.endsWith('.js')) out.push(p)
  }
  return out
}

const files = walk(root)
const engine = createEngine()
const cover = engine.cover()

// 每个模块 id → 源文件
const fileOf = {
  amygdala: 'organs/amygdala.js', hypothalamus: 'organs/hypothalamus.js',
  insula: 'organs/insula.js', hippocampus: 'organs/hippocampus.js',
  pfc: 'organs/pfc.js', neuromod: 'layers/neuromod.js', attention: 'layers/attention.js',
  social: 'layers/social.js', brainstem: 'supplements/brainstem.js', dmn: 'supplements/dmn.js',
  endocrine: 'supplements/endocrine.js', sickness: 'supplements/sickness.js',
  curve: 'time/curve.js', rhythm: 'time/rhythm.js', bias: 'io/bias.js', io: 'io/output.js',
  engine: 'core/engine.js', inject: 'core/inject.js',
}

const problems = []
for (const [mod, ids] of Object.entries(cover)) {
  const rel = fileOf[mod]
  if (!rel) { problems.push(`[${mod}] 没登记源文件`); continue }
  let src = readFileSync(join(root, rel), 'utf8')
  // 去掉 cover 声明行，避免自我证明
  src = src.replace(/cover:\s*\[[^\]]*\],?/gs, '')
  const tags = new Set((src.match(/\b[A-Z]\d{2}\b/g) || []))
  for (const id of ids) {
    if (!tags.has(id)) problems.push(`[${mod}] 声明了 ${id}，源码里没有标记`)
  }
}

const allTags = new Set()
for (const f of files) {
  const s = readFileSync(f, 'utf8').replace(/cover:\s*\[[^\]]*\],?/gs, '')
  for (const t of (s.match(/\b[A-Z]\d{2}\b/g) || [])) allTags.add(t)
}
const declared = new Set(Object.values(cover).flat())
for (const t of allTags) if (!declared.has(t)) problems.push(`源码里标了 ${t}，但没写进 cover`)

console.log(`模块 ${Object.keys(cover).length} 个，声明 ${declared.size} 条，源码标记 ${allTags.size} 条`)
if (problems.length) {
  console.log(`\n发现 ${problems.length} 处不一致：`)
  for (const p of problems) console.log(' -', p)
  process.exit(1)
}
console.log('审计通过：声明与源码标记一一对应')
