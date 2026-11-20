// 冒烟：每个文件都 import 一遍，抓语法错和循环依赖。
import { readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = fileURLToPath(new URL('.', import.meta.url))
const root = join(here, '..')

let ok = 0
let bad = 0

for (const d of ['core', 'organs', 'bridge']) {
  let files = []
  try { files = (await readdir(join(root, d))).filter((f) => f.endsWith('.js')) } catch { continue }
  for (const f of files) {
    try {
      await import(pathToFileURL(join(root, d, f)).href)
      ok += 1
    } catch (e) {
      bad += 1
      console.error(`  FAIL ${d}/${f}: ${e.message}`)
    }
  }
}

try {
  await import(pathToFileURL(join(root, 'index.js')).href)
  ok += 1
} catch (e) {
  bad += 1
  console.error(`  FAIL index.js: ${e.message}`)
}

console.log(`冒烟：${ok} 个导入成功，${bad} 个失败`)
process.exitCode = bad ? 1 : 0
