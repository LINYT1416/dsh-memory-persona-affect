// 极小的 jsonl / json 读写。没有依赖，失败不抛（器官不能因为 IO 挂掉）。
import { readFile, writeFile, mkdir, appendFile, rename } from 'node:fs/promises'
import { dirname } from 'node:path'

export async function ensureDir(p) {
  try { await mkdir(dirname(p), { recursive: true }) } catch { /* 已存在 */ }
}

export async function readJson(p, fallback = null) {
  try {
    const txt = await readFile(p, 'utf8')
    return txt.trim() ? JSON.parse(txt) : fallback
  } catch {
    return fallback
  }
}

export async function writeJson(p, value) {
  try {
    await ensureDir(p)
    await writeFile(p, JSON.stringify(value, null, 2), 'utf8')
    return true
  } catch {
    return false
  }
}

export async function readJsonl(p) {
  try {
    const txt = await readFile(p, 'utf8')
    const out = []
    for (const line of txt.split('\n')) {
      const s = line.trim()
      if (!s) continue
      try { out.push(JSON.parse(s)) } catch { /* 坏行跳过，不炸 */ }
    }
    return out
  } catch {
    return []
  }
}

export async function appendJsonl(p, row) {
  try {
    await ensureDir(p)
    await appendFile(p, JSON.stringify(row) + '\n', 'utf8')
    return true
  } catch {
    return false
  }
}

/** 覆盖写：先写临时文件再改名，避免半截。 */
export async function rewriteJsonl(p, rows) {
  try {
    await ensureDir(p)
    const tmp = `${p}.tmp`
    const body = rows.map((r) => JSON.stringify(r)).join('\n') + (rows.length ? '\n' : '')
    await writeFile(tmp, body, 'utf8')
    await rename(tmp, p)
    return true
  } catch {
    return false
  }
}

/** 保留最后 n 行。 */
export function tail(rows, n) {
  return rows.length > n ? rows.slice(rows.length - n) : rows
}
