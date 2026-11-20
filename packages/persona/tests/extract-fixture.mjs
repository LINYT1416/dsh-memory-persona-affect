// 从记忆插件自己的 raw 日志里取真实对话，做 10 轮生命周期测试的素材。
import { readFile, writeFile } from 'node:fs/promises'

const FILES = [
  'C:/Users/64091/.dsh/hippocampus/raw/raw-2026-11-11.jsonl',
  'C:/Users/64091/.dsh/hippocampus/raw/raw-2026-11-12.jsonl',
]

const strip = (t) => String(t).replace(/^【[^】]{0,12}】[^：]{0,8}：/, '').replace(/\s+/g, ' ').trim()

const rows = []
for (const f of FILES) {
  let txt = ''
  try { txt = await readFile(f, 'utf8') } catch { continue }
  for (const line of txt.split('\n')) {
    if (!line.trim()) continue
    try {
      const o = JSON.parse(line)
      if (o.role !== 'user' || !o.text) continue
      const text = strip(o.text)
      if ([...text].length < 6) continue
      rows.push({ text, at: o.at || 0 })
    } catch { /* 坏行跳过 */ }
  }
}

// 去重（测试注入的重复 + 同句多写）
const seen = new Set()
const uniq = []
for (const r of rows) {
  const k = r.text.slice(0, 40)
  if (seen.has(k)) continue
  seen.add(k)
  uniq.push(r)
}

// 均匀取 10 条，保证覆盖不同话题而不是连着的同一件事
const N = 10
const picked = []
for (let i = 0; i < N; i += 1) {
  const idx = Math.floor((i * (uniq.length - 1)) / Math.max(1, N - 1))
  picked.push(uniq[idx])
}

console.log(`用户条 ${rows.length}，去重后 ${uniq.length}，取 ${picked.length}`)
picked.forEach((p, i) => console.log(` ${i + 1}. ${p.text.slice(0, 56)}`))

await writeFile('E:/person/dsh-persona/tests/fixtures.json', JSON.stringify(picked, null, 1), 'utf8')
console.log('写到 tests/fixtures.json')
