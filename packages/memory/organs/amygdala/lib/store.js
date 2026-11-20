// 存储：只追加的 jsonl + 分卷 + 原子写 + 单写队列。
// 对应功能总表：A7-1 存储、A7-3 压缩、C4 单向。
// 不进同步范围由外层决定；这里只保证不存原文（C12）。

import { appendFile, mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

export const DATA_DIR = process.env.AMYGDALA_DIR || join(homedir(), '.dsh', 'amygdala')

export const FILES = {
  scores: join(DATA_DIR, 'scores.jsonl'),
  windows: join(DATA_DIR, 'windows.jsonl'),
  aversion: join(DATA_DIR, 'aversion.jsonl'),
  safety: join(DATA_DIR, 'safety.jsonl'),
  corrections: join(DATA_DIR, 'corrections.jsonl'),
  conflicts: join(DATA_DIR, 'conflicts.jsonl'),
  review: join(DATA_DIR, 'review.jsonl'),
  audit: join(DATA_DIR, 'audit.jsonl'),
  state: join(DATA_DIR, 'state.json'),
}

export async function ensureDirs() {
  await mkdir(DATA_DIR, { recursive: true })
}

// 单写队列：多会话同时写不会互相覆盖
let queue = Promise.resolve()

export function enqueue(task) {
  const next = queue.then(task, task)
  queue = next.catch(() => {})
  return next
}

export async function appendJsonl(file, obj) {
  await ensureDirs()
  const line = JSON.stringify(obj) + '\n'
  await enqueue(() => appendFile(file, line, 'utf8'))
}

export async function appendLines(file, objs) {
  if (!objs?.length) return
  await ensureDirs()
  const chunk = objs.map((o) => JSON.stringify(o)).join('\n') + '\n'
  await enqueue(() => appendFile(file, chunk, 'utf8'))
}

export async function readJsonl(file, { limit = 0 } = {}) {
  try {
    const text = await readFile(file, 'utf8')
    const rows = []
    for (const line of text.split('\n')) {
      const s = line.trim()
      if (!s) continue
      try {
        rows.push(JSON.parse(s))
      } catch { /* 半截行跳过 */ }
    }
    return limit > 0 ? rows.slice(-limit) : rows
  } catch {
    return []
  }
}

export async function readJson(file, fallback = null) {
  try {
    return JSON.parse(await readFile(file, 'utf8'))
  } catch {
    return fallback
  }
}

export async function writeJsonAtomic(file, value) {
  await ensureDirs()
  const tmp = `${file}.tmp-${process.pid}`
  await enqueue(async () => {
    await writeFile(tmp, JSON.stringify(value, null, 2), 'utf8')
    await rename(tmp, file)
  })
}

export async function rewriteJsonl(file, rows) {
  await ensureDirs()
  const tmp = `${file}.rewrite-${process.pid}`
  const text = rows.map((r) => JSON.stringify(r)).join('\n') + (rows.length ? '\n' : '')
  await enqueue(async () => {
    await writeFile(tmp, text, 'utf8')
    await rename(tmp, file)
  })
}

export async function listFiles(dir = DATA_DIR) {
  try {
    return (await readdir(dir)).filter((n) => n.endsWith('.jsonl')).sort()
  } catch {
    return []
  }
}

export function exists(file) {
  return existsSync(file)
}

export async function sizeOf(file) {
  try {
    return Buffer.byteLength(await readFile(file, 'utf8'), 'utf8')
  } catch {
    return 0
  }
}
