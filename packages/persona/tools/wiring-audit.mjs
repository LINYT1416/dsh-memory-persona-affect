// 接线审计：import 进来的每个函数/对象，在 index.js 里除了 import 行之外真的被用了吗？
// 这能抓"写了模块、也写了测试，但主流程从不调用"的假阳性。
import { readFileSync, readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
const src = readFileSync(join(root, 'index.js'), 'utf8')
const lines = src.split('\n')

const imports = []
for (const line of lines) {
  const m = line.match(/^import\s+\{([^}]+)\}\s+from\s+'\.\/core\/([^']+)'/)
  if (m) imports.push({ names: m[1].split(',').map((s) => s.trim()).filter(Boolean), mod: m[2] })
}

const body = lines.filter((l) => !/^import\s/.test(l)).join('\n')
const rows = []
for (const imp of imports) {
  for (const name of imp.names) {
    const re = new RegExp('\\b' + name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'g')
    const hits = (body.match(re) || []).length
    rows.push({ name, mod: imp.mod, hits })
  }
}

const unused = rows.filter((r) => r.hits === 0)
console.log('core 模块导入：' + imports.length + ' 个文件，' + rows.length + ' 个符号')
if (unused.length) {
  console.log('未被调用（假阳性风险）：')
  for (const u of unused) console.log('  - ' + u.name + '  (core/' + u.mod + ')')
} else {
  console.log('全部符号都在主流程里被调用过')
}

// 反向：core 目录里的模块有没有完全没被 index 引用
const files = readdirSync(join(root, 'core')).filter((f) => f.endsWith('.js'))
const importedMods = new Set(imports.map((i) => i.mod))
const orphan = files.filter((f) => !importedMods.has(f))
if (orphan.length) {
  console.log('core 里没被 index 引用的模块：' + orphan.join(', '))
}

process.exitCode = unused.length ? 2 : 0
