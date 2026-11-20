// 生成符号索引：文件、行数、关键函数所在行。给交接文档用，别手写行号。
import { readdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

const RE = /^(?:export\s+)?(?:async\s+)?function\s+(\w+)|^(?:export\s+)?const\s+(\w+)\s*=\s*(?:createEngine|createSignatures|createTracker|createStore|createAffectBridge|createMemoryBridge)\b|^\s{2}function\s+(\w+)/
const RE2 = /^(?:export\s+)?const\s+([A-Z_0-9]+)\s*=/

const out = []
for (const d of ['core', 'organs', 'bridge', 'tests', '.']) {
  let files = []
  try {
    files = (await readdir(d)).filter((f) => f.endsWith('.js') || f.endsWith('.mjs'))
  } catch { continue }
  for (const f of files.sort()) {
    const p = d === '.' ? f : join(d, f)
    const lines = (await readFile(p, 'utf8')).split('\n')
    const marks = []
    lines.forEach((l, i) => {
      const m = l.match(RE) || l.match(RE2)
      if (m) marks.push(`${m[1] || m[2] || m[3] || m[4]}@${i + 1}`)
    })
    out.push(`${p.padEnd(28)} ${String(lines.length).padStart(4)} 行  ${marks.slice(0, 16).join('  ')}`)
  }
}

console.log(out.join('\n'))
await writeFile('E:/person/dsh-persona/tests/index.txt', out.join('\n'), 'utf8')
