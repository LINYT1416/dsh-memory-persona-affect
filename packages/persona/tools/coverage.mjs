// 全量覆盖账本：从四份规格里把所有条目抽出来，逐条对"有没有代码、有没有断言"。
// 不靠记忆、不靠手填：只看仓库里真实存在的注释和测试文件。
import { readFileSync, readdirSync, writeFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
const person = 'E:/person'

const spec = readFileSync(join(person, '人格-功能总表.md'), 'utf8')
const rows = []
for (const line of spec.split('\n')) {
  const m = line.match(/^\|\s*([A-Z]\d{2})\s*\|\s*([^|]+?)\s*\|/)
  if (m) rows.push({ id: m[1], name: m[2].trim() })
}

// 代码里的 ID 注释
const codeFiles = []
const walk = (dir) => {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules') continue
    const p = join(dir, e.name)
    if (e.isDirectory()) walk(p)
    else if (/\.(js|mjs)$/.test(e.name)) codeFiles.push(p)
  }
}
// 委托出去的器官（心情侧）：人格本身不实现它们，但不能当它们不存在
const AFFECT_ROOTS = ['E:/heart/packages/dsh-affect', 'E:/heart/packages/dsh-affect-core']
const affectCode = []
const affectTests = []
for (const r of AFFECT_ROOTS) {
  if (!existsSync(r)) continue
  const walkA = (dir) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (e.name === 'node_modules') continue
      const q = join(dir, e.name)
      if (e.isDirectory()) walkA(q)
      else if (/\.(js|mjs)$/.test(e.name)) {
        if (/(^|[\\/])(test|tests|spec)([\\/]|$)/.test(q)) affectTests.push({ f: q, t: readFileSync(q, 'utf8') })
        else affectCode.push({ p: q, t: readFileSync(q, 'utf8') })
      }
    }
  }
  walkA(r)
}
walk(join(root, 'core'))
walk(join(root, 'tools'))
for (const f of ['index.js', 'panel.js', 'looks.js']) { const q = join(root, f); if (existsSync(q)) codeFiles.push(q) }

const codeText = codeFiles.map((p) => ({ p, t: readFileSync(p, 'utf8') }))
const testFiles = readdirSync(join(root, 'tests')).filter((f) => f.endsWith('.mjs'))
  .map((f) => ({ f, t: readFileSync(join(root, 'tests', f), 'utf8') }))
  .concat(affectTests)

// 有实现、有断言，但还没接进注入流程的：不能算"已做"
const NOT_WIRED = {}

const rel = (p) => p.replace(root + '\\', '').replace(root + '/', '').replace(/\\/g, '/')

const out = []
const stat = { done: 0, partial: 0, none: 0 }
for (const r of rows) {
  const test = testFiles.find((x) => x.t.includes(r.id))
  const code = codeText.find((x) => x.t.includes(r.id)) || affectCode.find((x) => x.t.includes(r.id))
  // 没有编号时，再用功能名的关键词找一遍代码：找到算"疑似有实现，缺断言"
  const kw = r.name.split(/[：:]/)[0].slice(0, 2)
  const keywordHit = kw.length >= 2 ? (codeText.find((x) => x.t.includes(kw)) || affectCode.find((x) => x.t.includes(kw))) : null
  let status = '没做'
  let evidence = '—'
  if (test) { status = '已做'; evidence = 'tests/' + test.f }
  else if (code) { status = '部分'; evidence = rel(code.p) + '（有实现，无断言）' }
  else if (keywordHit) { status = '部分'; evidence = rel(keywordHit.p) + '（代码提到「' + kw + '」，无断言）' }
  if (status === '已做' && NOT_WIRED[r.id]) { status = '部分'; evidence = NOT_WIRED[r.id] }
  if (status === '已做') stat.done++
  else if (status === '部分') stat.partial++
  else stat.none++
  out.push({ ...r, status, evidence })
}

const lines = []
lines.push('# 全量覆盖账本（按规格逐条，不靠记忆）')
lines.push('')
lines.push(`> 生成时间：${new Date().toISOString().slice(0, 19).replace('T', ' ')}`)
lines.push(`> 规格来源：E:/person/人格-功能总表.md（本表抽出 ${rows.length} 条）`)
lines.push(`> 代码范围：dsh-persona + 委托的 dsh-affect / dsh-affect-core（${affectCode.length} 个文件）`)
lines.push('')
lines.push('判定规则（机械判定，可复查）：')
lines.push('')
lines.push('- **已做**：有一个测试文件里提到这个编号（说明有可复现断言）')
lines.push('- **部分**：只有代码注释提到编号，没有任何测试提到（有实现，没断言）')
lines.push('- **没做**：代码和测试都没有提到这个编号')
lines.push('')
lines.push(`## 汇总：已做 ${stat.done} / 部分 ${stat.partial} / 没做 ${stat.none}（共 ${rows.length} 条）`)
lines.push('')
lines.push('| 编号 | 功能 | 状态 | 证据 |')
lines.push('| --- | --- | --- | --- |')
for (const r of out) lines.push(`| ${r.id} | ${r.name} | ${r.status} | ${r.evidence} |`)

const target = join(root, 'docs', 'coverage-full.md')
writeFileSync(target, lines.join('\n') + '\n', 'utf8')
console.log(`已生成 ${rel(target)}：共 ${rows.length} 条`)
console.log(`已做 ${stat.done} / 部分 ${stat.partial} / 没做 ${stat.none}`)
if (stat.none) {
  console.log('没做的：' + out.filter((x) => x.status === '没做').map((x) => x.id + ' ' + x.name).join('；'))
}
if (stat.partial) {
  console.log('部分的：' + out.filter((x) => x.status === '部分').map((x) => x.id).join(', '))
}
