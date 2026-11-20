import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadUsed, saveUsed } from '../core/remember.js'
const dir = mkdtempSync(join(tmpdir(), 'recall-'))
const file = join(dir, 'persona', 'recall.json')
const fails = []
const empty = loadUsed(file)
if (empty.size !== 0) fails.push('文件不存在时应该是空集，实际 ' + empty.size)
const set = new Set(['a', 'b', 'c'])
if (!saveUsed(file, set)) fails.push('saveUsed 失败')
const back = loadUsed(file)
if (back.size !== 3 || !back.has('b')) fails.push('读回来的不对：' + JSON.stringify([...back]))
const big = new Set(Array.from({ length: 300 }, (_, i) => 'x' + i))
saveUsed(file, big)
if (loadUsed(file).size !== 200) fails.push('上限 200 没生效：' + loadUsed(file).size)
writeFileSync(file, '{坏json', 'utf8')
if (loadUsed(file).size !== 0) fails.push('坏文件应该回空集')
rmSync(dir, { recursive: true, force: true })
if (fails.length) { fails.forEach((f) => console.log('FAIL ' + f)); process.exit(1) }
console.log('PASS 主动提起落盘（写入/读回/上限 200/坏文件回空）')
