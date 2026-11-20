import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createMemoryBridge } from '../bridge/memory.js'
const home = mkdtempSync(join(tmpdir(), 'wide-'))
process.env.HIPPOCAMPUS_DIR = home
const now = Date.now()
const rows = []
for (let i = 0; i < 40; i += 1) rows.push({ summary: `我说：第 ${i} 件旧事`, start: now - (40 - i) * 3600_000 })
rows.push({ summary: '【情绪】委屈：不该进来', start: now - 3 * 86400_000 })
writeFileSync(join(home, 'episodes.jsonl'), rows.map((r) => JSON.stringify(r)).join('\n'), 'utf8')
const b = createMemoryBridge(() => null)
await b.refresh(6)
const cached = b.episodes()
const wide = b.wide(200)
const fails = []
if (!(wide.length > cached.length)) fails.push(`wide 应该比缓存多：wide=${wide.length} cache=${cached.length}`)
if (wide.some((r) => /情绪/.test(r.brief))) fails.push('情绪条目漏进来了')
if (wide.length < 40) fails.push('wide 没读到足够多：' + wide.length)
if (wide.some((r) => !Number.isFinite(Number(r.at)))) fails.push('有行没有时间戳')
rmSync(home, { recursive: true, force: true })
if (fails.length) { fails.forEach((f) => console.log('FAIL ' + f)); process.exit(1) }
console.log(`PASS wide 能读到更久以前的记忆（缓存 ${cached.length} 条 → wide ${wide.length} 条，情绪已过滤）`)
