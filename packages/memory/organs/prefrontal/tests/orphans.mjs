// 孤儿检测：每个 export 有没有人真的调用。
// 这一类缺口最阴——功能写了、测试也过，但主路径根本没接上。
// 跑法：node tests/orphans.mjs
import { readFile, readdir } from 'node:fs/promises'
import { join, dirname, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const DIRS = ['kernel', 'store', 'host', 'seams', '.']

async function files(dir) {
  const out = []
  const full = join(ROOT, dir)
  const list = await readdir(full, { withFileTypes: true }).catch(() => [])
  for (const d of list) {
    if (d.isDirectory()) { out.push(...(await files(join(dir, d.name)))); continue }
    if (d.name.endsWith('.js') && d.name !== 'index.js') out.push(join(dir, d.name))
  }
  if (dir === '.') {
    for (const d of list) {
      if (d.isFile() && d.name === 'index.js') out.push('index.js')
    }
  }
  return out
}

const all = []
for (const d of ['kernel', 'store', 'host', 'seams', '.']) {
  for (const f of await files(d)) if (!all.includes(f)) all.push(f)
}

const texts = new Map()
for (const f of all) texts.set(f, await readFile(join(ROOT, f), 'utf8'))

const EXPORT_RE = /export\s+(?:async\s+)?(?:function|const|let|class)\s+([A-Za-z_$][\w$]*)/g

const orphans = []
const rows = []
for (const [file, text] of texts) {
  const names = new Set()
  for (const m of text.matchAll(EXPORT_RE)) names.add(m[1])
  for (const name of names) {
    let refs = 0
    const where = []
    for (const [other, otherText] of texts) {
      if (other === file) continue
      if (name.length < 3) continue
      const re = new RegExp(`\\b${name}\\b`, 'g')
      const hits = (otherText.match(re) || []).length
      if (hits) { refs += hits; where.push(`${other}×${hits}`) }
    }
    rows.push({ file, name, refs, where })
    if (refs === 0) orphans.push({ file, name })
  }
}

console.log('\n前额叶 · 孤儿检测（写了但没人调）\n' + '='.repeat(52))
console.log(`检查 ${all.length} 个文件，${rows.length} 个导出`)

const byFile = new Map()
for (const o of orphans) {
  const list = byFile.get(o.file) || []
  list.push(o.name)
  byFile.set(o.file, list)
}

if (!orphans.length) {
  console.log('\n✓ 没有零引用的导出')
} else {
  console.log(`\n✗ ${orphans.length} 个导出零引用：\n`)
  for (const [f, names] of [...byFile.entries()].sort()) {
    console.log(`  ${f}`)
    for (const n of names) console.log(`      - ${n}`)
  }
}

// 只被"一个文件"引用的，也列出来看看是不是太窄
const narrow = rows.filter((r) => r.refs === 1)
if (narrow.length) {
  console.log(`\n· 只被引用一次（共 ${narrow.length} 个）：`)
  for (const r of narrow.slice(0, 40)) console.log(`  ${r.name}  ← ${r.where.join(',')}`)
}

console.log('\n' + '='.repeat(52))
console.log(orphans.length === 0 ? '全部有调用方' : `${orphans.length} 个没人调`)
process.exit(0)
