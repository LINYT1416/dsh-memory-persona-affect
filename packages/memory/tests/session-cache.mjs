// 一轮一条：从投影缓存读对话，按"她说的 + 我说的"合成一条。
import { turnsOfCache, turnToItem, pullFromCache, recentCacheFiles, CACHE_DIR } from '../organs/hippocampus/lib/session-cache.js'
import fs from 'node:fs'

let fail = 0
const ok = (c, m) => { if (!c) { fail++; console.log('FAIL', m) } else { console.log('  ok:', m) } }

// 1) 真实文件：轮次能解析
const files = recentCacheFiles(CACHE_DIR)
ok(files.length > 0, `应找到缓存文件（${files.length} 个）`)
const biggest = files.map((f) => ({ f, n: turnsOfCache(f.file).length })).sort((a, b) => b.n - a.n)[0]
ok(biggest?.n > 0, `最大文件应含轮次（${biggest?.n}）`)

// 2) 一轮合成一条；最长的轮次够长（短寒暄本来就该是短的）
const allTurns = turnsOfCache(biggest.f.file)
const item = turnToItem(allTurns[allTurns.length - 1])
ok(item.role === 'user', '合成后的角色应为 user')
ok(item.text.includes('她说：') || item.text.includes('我说：'), '文本应带「她说/我说」前缀')
const longest = allTurns.map((t) => turnToItem(t).text.length).sort((a, b) => b - a)[0]
ok(longest > 100, `最长的轮次应足够长（实际 ${longest} 字）`)

// 3) 首次对齐不写历史
const cursors = new Map()
const written = []
await pullFromCache([biggest.f], cursors, async (it) => written.push(it))
ok(written.length === 0, `首次不该写历史（实际 ${written.length}）`)

// 4) 没有新轮次不重复写
await pullFromCache([biggest.f], cursors, async (it) => written.push(it))
ok(written.length === 0, '没有新轮次时不该写')

// 5) 新增一轮 → 只写 1 条
const tmp = 'C:/Users/64091/.dsh/hippocampus/_t-cache.json'
const name = tmp.split('/').pop()
const prev = cursors.get(biggest.f.name)
fs.writeFileSync(tmp, JSON.stringify({
  record: { rows: { a: { val: { turns: [
    { turn: 1, seq: prev - 5, prompt: '旧问题', response: '旧回答' },
    { turn: 2, seq: prev + 10, prompt: '新问题', response: '新回答' },
  ] } } } },
}))
const c2 = new Map([[name, prev]])
written.length = 0
await pullFromCache([{ file: tmp, name }], c2, async (it) => written.push(it))
ok(written.length === 1, `新增一轮应只写 1 条（实际 ${written.length}）`)
ok(written[0].text.includes('新问题') && written[0].text.includes('新回答'), '一条里应同时含两边的原话')
fs.unlinkSync(tmp)

// 6) 坏文件不炸
const bad = 'C:/Users/64091/.dsh/hippocampus/_t-bad.json'
fs.writeFileSync(bad, '{ not json')
ok(turnsOfCache(bad).length === 0, '坏 JSON 应返回空')
fs.unlinkSync(bad)

console.log(fail ? `FAIL ${fail}` : 'PASS 一轮一条（真实文件/合成/首次对齐/增量/坏文件）')
process.exit(fail ? 1 : 0)
