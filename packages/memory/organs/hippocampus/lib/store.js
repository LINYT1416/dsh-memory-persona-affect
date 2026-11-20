// 存储层：只追加的 jsonl + 原子写 + 单写队列。
// 对应功能总表：L2-1 内容层、L2-2 索引层、L5-7 raw 归档分卷、L5-3 索引重建、C2 内容索引分离。
import { appendFile, mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, isAbsolute } from 'node:path'
import { localDay } from './util.js'

// 测试时可以用 HIPPOCAMPUS_DIR 指到临时目录，不碰真实数据。
export const DATA_DIR = process.env.HIPPOCAMPUS_DIR || join(homedir(), '.dsh', 'hippocampus')
export const RAW_DIR = join(DATA_DIR, 'raw')
export const FILES = {
  episodes: join(DATA_DIR, 'episodes.jsonl'),
  index: join(DATA_DIR, 'index.jsonl'),
  links: join(DATA_DIR, 'links.jsonl'),
  traces: join(DATA_DIR, 'traces.jsonl'),
  candidates: join(DATA_DIR, 'candidates.jsonl'),
  consolidation: join(DATA_DIR, 'consolidation.jsonl'),
  encode: join(DATA_DIR, 'encode.log'),
  meta: join(DATA_DIR, 'meta.json'),
  vectors: join(DATA_DIR, 'vectors.json'),
  graph: join(DATA_DIR, 'graph.json'),
  shadow: join(DATA_DIR, 'shadow.log'),
}

export async function ensureDirs() {
  await mkdir(DATA_DIR, { recursive: true })
  await mkdir(RAW_DIR, { recursive: true })
}

// ── 单写队列（R 串行写：多会话同时说也不会互相覆盖）──────────────
let queue = Promise.resolve()
export function enqueue(task) {
  const next = queue.then(task, task)
  // 队列自己吞错，避免一个坏任务把后面全卡死
  queue = next.catch(() => {})
  return next
}

/** 追加一行 JSON。单次 appendFile 调用，O_APPEND 保证不覆盖。 */
export async function appendJsonl(file, obj) {
  await ensureDirs()
  const line = JSON.stringify(obj) + '\n'
  const target = resolveFile(file)
  await enqueue(() => appendFile(target, line, 'utf8'))
}

/** 裸文件名一律落到数据目录，不再依赖进程 CWD。 */
export function resolveFile(file) {
  const name = String(file || '')
  if (!name) return name
  return isAbsolute(name) ? name : join(DATA_DIR, name)
}

export async function appendLines(file, objs) {
  if (!objs?.length) return
  await ensureDirs()
  const chunk = objs.map((o) => JSON.stringify(o)).join('\n') + '\n'
  await enqueue(() => appendFile(file, chunk, 'utf8'))
}

/** 读一个 jsonl；坏行跳过，不炸整个文件。 */
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

/** raw 分卷：按本地日一个文件（L5-7）。 */
export function rawFile(day = localDay()) {
  return join(RAW_DIR, `raw-${day}.jsonl`)
}

export async function appendRaw(row) {
  await ensureDirs()
  const day = localDay(row.at ?? Date.now())
  await appendJsonl(rawFile(day), row)
}

export async function readRawDays(days = 30) {
  await ensureDirs()
  let names = []
  try {
    names = (await readdir(RAW_DIR)).filter((n) => n.endsWith('.jsonl')).sort()
  } catch { return [] }
  const picked = days > 0 ? names.slice(-days) : names
  const out = []
  for (const name of picked) out.push(...(await readJsonl(join(RAW_DIR, name))))
  return out
}

export async function readRawById(id) {
  const all = await readRawDays(0)
  return all.find((r) => r.id === id) || null
}

export async function readJson(file, fallback = null) {
  try {
    return JSON.parse(await readFile(file, 'utf8'))
  } catch {
    return fallback
  }
}

/** 原子写：先写临时文件再 rename（L4-10 锁存落盘）。 */
export async function writeJsonAtomic(file, value) {
  await ensureDirs()
  const tmp = `${file}.tmp-${process.pid}`
  await enqueue(async () => {
    await writeFile(tmp, JSON.stringify(value, null, 2), 'utf8')
    await rename(tmp, file)
  })
}

export async function readMeta() {
  return (await readJson(FILES.meta, null)) || {
    version: 1,
    createdAt: Date.now(),
    lastEpisodeSeq: 0,
    lastRawSeq: 0,
    lastConsolidateAt: 0,
    lastEncodeAt: 0,
    stats: {},
  }
}

export async function writeMeta(meta) {
  await writeJsonAtomic(FILES.meta, meta)
}

export function exists(file) {
  return existsSync(file)
}

/** 增量边落盘（L2-3）：tick 时把内存里新长出来的边刷进 links.jsonl。 */
export async function appendLinks(edges) {
  if (!edges?.length) return
  await appendLines(FILES.links, edges)
}

export async function fileSize(file) {
  try {
    const text = await readFile(file, 'utf8')
    return Buffer.byteLength(text, 'utf8')
  } catch {
    return 0
  }
}

/** 全量重写（压缩/归档时用，慎用；正常路径只追加）。 */
export async function rewriteJsonl(file, rows) {
  await ensureDirs()
  const tmp = `${file}.rewrite-${process.pid}`
  const text = rows.map((r) => JSON.stringify(r)).join('\n') + (rows.length ? '\n' : '')
  await enqueue(async () => {
    await writeFile(tmp, text, 'utf8')
    await rename(tmp, file)
  })
}
