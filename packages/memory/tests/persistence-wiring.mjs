// 数据文件接线检查：有没有"只读、没人写"的文件。
//
// 上一轮的 bug 就是这一类：`aversion.jsonl` 启动时认真读、但全仓库没人写，
// 于是"学到的怕"活不过重启，而代码看起来一切正常。
// 这条测试把这类问题变成会红的东西：
//   - 有读、没写  → FAIL（功能永远读空文件）
//   - 只写不读    → 允许（日志/流水，故意只追加）
//   - 定义了没用  → 只打印，不判失败（可能是预留）
//
//   node tests/persistence-wiring.mjs
import { readdirSync, readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const READERS = /^(read|load|exists|stat)/i

const walk = (d, out = []) => {
  for (const n of readdirSync(d, { withFileTypes: true })) {
    if (n.name === 'node_modules' || n.name.startsWith('.') || n.name === 'tests') continue
    const p = join(d, n.name)
    if (n.isDirectory()) walk(p, out)
    else if (n.name.endsWith('.js')) out.push(p)
  }
  return out
}

const files = walk(ROOT)
const texts = files.map((f) => [f, readFileSync(f, 'utf8')])

const defs = new Map()
for (const [f, t] of texts) {
  const m = t.match(/const FILES\s*=\s*\{([\s\S]*?)\n\}/)
  if (!m) continue
  for (const line of m[1].split('\n')) {
    const k = line.match(/^\s*([A-Za-z0-9_]+)\s*:\s*join\(/)
    if (k) defs.set(k[1], f)
  }
}

if (!defs.size) {
  console.log('FAIL 没找到 FILES 定义——这个测试的假设过期了，得先改它')
  process.exit(1)
}

const stats = []
for (const key of defs.keys()) {
  let readers = 0
  let writers = 0
  for (const [, t] of texts) {
    for (const line of t.split('\n')) {
      if (!new RegExp(`FILES\\.${key}\\b`).test(line)) continue
      const m = line.match(/([A-Za-z0-9_$.]+)\s*\([^)]*FILES\./)
      const fn = m ? m[1].split('.').pop() : ''
      if (READERS.test(fn)) readers += 1
      else writers += 1
    }
  }
  stats.push({ key, readers, writers })
}

const dead = stats.filter((s) => s.readers > 0 && s.writers === 0)
const unused = stats.filter((s) => s.readers === 0 && s.writers === 0)

if (dead.length) {
  console.log(`FAIL ${dead.length}：这些文件只读不写，读到的永远是空的/旧数据`)
  for (const d of dead) console.log(` - ${d.key}（读 ${d.readers} 处，写 0 处）`)
  process.exit(1)
}

const readOnlyLogs = stats.filter((s) => s.readers === 0 && s.writers > 0).map((s) => s.key)
console.log(`PASS 数据文件接线（FILES ${stats.length} 个，全部至少有人写；只写不读的流水 ${readOnlyLogs.length} 个：${readOnlyLogs.join(',') || '无'}${unused.length ? `；定义了没人用 ${unused.length} 个：${unused.map((u) => u.key).join(',')}` : ''}）`)
process.exit(0)
