import fs from 'node:fs'
// 存储层：只追加 jsonl + 原子写 + 单写队列 + 快照。
// 对应：C2 内容与索引分离、C4 来源置信度、F13 版本与回滚、F19 审计。
import { appendFile, mkdir, readFile, readdir, rename, unlink, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

export const DATA_DIR = process.env.CORTEX_DIR || join(homedir(), '.dsh', 'cortex')
export const SNAP_DIR = join(DATA_DIR, 'snapshots')

export const FILES = {
  cells: join(DATA_DIR, 'cells.jsonl'),
  graph: join(DATA_DIR, 'graph.jsonl'),
  conflicts: join(DATA_DIR, 'conflicts.jsonl'),
  traces: join(DATA_DIR, 'traces.jsonl'),
  audit: join(DATA_DIR, 'audit.jsonl'),
  outbox: join(DATA_DIR, 'outbox.jsonl'),
  meta: join(DATA_DIR, 'meta.json'),
}

export async function ensureDirs() {
  await mkdir(DATA_DIR, { recursive: true })
  await mkdir(SNAP_DIR, { recursive: true })
}

let queue = Promise.resolve()
export function enqueue(task) {
  const next = queue.then(task, task)
  queue = next.catch(() => {})
  return next
}

export async function appendJsonl(file, obj) {
  await ensureDirs()
  // 目录可能已经被删掉（测试收尾 / 用户清数据）：落盘失败不该把进程带崩。
  // 以前这里裸 appendFile，rebuild/attach 的异步写在 tmp 目录消失后抛 ENOENT 未捕获。
  await enqueue(() => appendFile(file, JSON.stringify(obj) + '\n', 'utf8').catch(() => {}))
}

export async function appendLines(file, objs) {
  if (!objs?.length) return
  await ensureDirs()
  const chunk = objs.map((o) => JSON.stringify(o)).join('\n') + '\n'
  await enqueue(() => appendFile(file, chunk, 'utf8').catch(() => {}))
}

export async function readJsonl(file, { limit = 0 } = {}) {
  try {
    const text = await readFile(file, 'utf8')
    const rows = []
    for (const line of text.split('\n')) {
      const s = line.trim()
      if (!s) continue
      try { rows.push(JSON.parse(s)) } catch { /* 半截行跳过 */ }
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

export async function readMeta() {
  return (await readJson(FILES.meta, null)) || {
    version: 1,
    schemaVersion: 1,
    createdAt: Date.now(),
    cursor: 0,
    snapshotSeq: 0,
    lastDistillAt: 0,
    stats: {},
  }
}

export async function writeMeta(meta) {
  await writeJsonAtomic(FILES.meta, meta)
}

export function exists(file) {
  return existsSync(file)
}

/** 快照：蒸馏前落一份，供 F13 回滚。 */
export async function writeSnapshot(seq, payload) {
  await ensureDirs()
  const name = `snap-${String(seq).padStart(6, '0')}.json`
  await writeJsonAtomic(join(SNAP_DIR, name), payload)
  return join(SNAP_DIR, name)
}

export async function listSnapshots() {
  try {
    const names = (await readdir(SNAP_DIR)).filter((n) => n.startsWith('snap-') && n.endsWith('.json')).sort()
    return names
  } catch {
    return []
  }
}

export async function readSnapshot(name) {
  return readJson(join(SNAP_DIR, name), null)
}

export async function pruneSnapshots(keep = 10) {
  const names = await listSnapshots()
  const drop = names.slice(0, Math.max(0, names.length - keep))
  for (const n of drop) {
    try { await unlink(join(SNAP_DIR, n)) } catch { /* 删不掉就算了 */ }
  }
}

export async function fileSize(file) {
  try {
    return Buffer.byteLength(await readFile(file, 'utf8'), 'utf8')
  } catch {
    return 0
  }
}

// ── 内存态（cells / 图 / 冲突）────────────────────────────────
import { cellKey, normalizeCell, touch } from './schema.js'
import { FeatureSpace } from './features.js'
import { levelOf } from './levels.js'

export class CortexStore {
  constructor() {
    this.cells = new Map()      // id -> cell
    this.byKey = new Map()      // cellKey -> id
    this.graph = []             // {from,to,kind,w,at}
    this.conflicts = []         // {at,a,b,reason,state}
    this.features = new FeatureSpace()
    this.loaded = false
  }

  async init() {
    if (this.loaded) return this
    let rows = await readJsonl(FILES.cells)
    // 同一个 id 在文件里出现几十次（每次落盘都追加一行），页面按行渲染就会看到"记忆重复"。
    // 这里启动时自愈：按 id 留最后一行（append-only 的最后一条是最新版本）重写文件。
    try {
      const ids = new Set(rows.map((r) => r && r.id).filter(Boolean))
      if (rows.length > ids.size * 1.2) {
        const keep = new Map()
        for (const r of rows) if (r && r.id) keep.set(r.id, r)
        const compacted = [...keep.values()]
        try { fs.copyFileSync(FILES.cells, FILES.cells + '.bak-compact-' + Date.now()) } catch { /* 备份失败也要压缩 */ }
        fs.writeFileSync(FILES.cells, compacted.map((r) => JSON.stringify(r)).join('\n') + '\n', 'utf8')
        this.compactedFrom = rows.length
        this.compactedTo = compacted.length
        rows = compacted
      }
    } catch { /* 压缩失败就按原样加载 */ }
    // 记住每条的磁盘原样：加载时 put() 会顺手算出 supports，但 persist:false 不落盘，
    // 结果就是"内存里有、文件里没有"，重启后重算一遍，永远补不上（这就是之前 supports 恒为 0 的根因）。
    const diskSupports = new Map()
    for (const row of rows) diskSupports.set(row.id, Array.isArray(row.supports) ? row.supports.length : 0)
    for (const row of rows) this.put(normalizeCell(row), { persist: false })
    // 同一句话会被抽成多面（fact/event/relation），各自一个 id，页面上就是"记忆重复"。
    // 这里按归一化文本合并：留证据最多的那条当主 cell，其余记为 aliases 后不再单独出现。
    try {
      const seen = new Map()
      for (const c of this.allCells()) {
        const body = String(c.text || '').replace(/\s+/g, '').toLowerCase()
        const anc = (Array.isArray(c.anchors) && c.anchors[0]) ? String(c.anchors[0]) : ''
        // 同一条 episode 的正文相同、object 截断不同 → 视为同一条
        const key = anc ? anc + '#' + body.slice(0, 24) : body
        if (!key) continue
        const score = (Number(c.evidenceCount) || 0) * 100 + (Array.isArray(c.supportIds) ? c.supportIds.length : 0) * 10 + (Number(c.lastSeen) || 0) / 1e12
        const prev = seen.get(key)
        if (!prev) { seen.set(key, { keep: c, score, alias: [] }); continue }
        if (score > prev.score) { prev.alias.push(prev.keep.id); prev.keep = c; prev.score = score }
        else prev.alias.push(c.id)
      }
      for (const { keep, alias } of seen.values()) {
        if (!alias.length) continue
        keep.aliases = [...new Set([...(keep.aliases || []), ...alias])]
        for (const id of alias) if (id !== keep.id) this.cells.delete(id)
      }
      this.textDeduped = [...seen.values()].reduce((n, x) => n + x.alias.length, 0)
      // 合并后把文件也收敛一次（否则下次启动还要再合一遍，文件一直膨胀）
      if (this.textDeduped > 0) {
        try {
          const keep = this.allCells().map((c) => JSON.stringify(c)).join('\n') + '\n'
          fs.copyFileSync(FILES.cells, FILES.cells + '.bak-textdedupe-' + Date.now())
          fs.writeFileSync(FILES.cells, keep, 'utf8')
          this.writeTextDeduped = this.textDeduped
        } catch { /* 写不动就只做内存合并 */ }
      }
    } catch { /* 合并失败不影响主流程 */ }

    this.graph = await readJsonl(FILES.graph)
    this.conflicts = await readJsonl(FILES.conflicts)
    // 同一对只留最后一条状态（open → stale/resolved 覆盖），避免统计重复
    const seen = new Map()
    for (const c of this.conflicts) {
      const k = `${c.aId}|${c.bId}`
      seen.set(k, c)
    }
    this.conflicts = [...seen.values()]
    this.loaded = true

    // 兜底：算出了 supports 但磁盘上没有 → 立刻补写一次（幂等：磁盘有了就不再写）
    try {
      const dirty = this.allCells().filter((c) => Array.isArray(c.supports) && c.supports.length && !diskSupports.get(c.id))
      for (const c of dirty) {
        c.version = (Number(c.version) || 1) + 1
        c.updatedAt = Date.now()
        await appendJsonl(FILES.cells, c)
      }
      this.supportBackfilled = dirty.length
    } catch (e) {
      this.supportBackfillError = String(e?.message || e)
      this.supportBackfilled = 0
    }

    return this
  }

  allCells() {
    return [...this.cells.values()]
  }

  /** 同一段记忆（同 anchor）且开头文字一致 → 视为同一条。
   *  抽取器对同一条 episode 会切出不同截断的 object（"基于 Part"/"基于…这"），
   *  cellKey 因此不同，但它们其实是一句话。 */
  findByAnchorText(anchorId, text) {
    const a = String(anchorId || '')
    const key = String(text || '').replace(/\s+/g, '').slice(0, 24)
    if (!a || !key) return null
    for (const c of this.cells.values()) {
      const anchors = Array.isArray(c.anchors) ? c.anchors : []
      if (!anchors.includes(a)) continue
      const k2 = String(c.text || '').replace(/\s+/g, '').slice(0, 24)
      if (k2 === key) return c
    }
    return null
  }

  /** 同主体+同谓词：用来识别"同一条事实换了值"（如地点 威海→青岛） */
  findBySubjectPredicate(subject, predicate) {
    const su = String(subject || '').trim()
    const pr = String(predicate || '').trim()
    if (!su || !pr) return null
    let best = null
    for (const c of this.cells.values()) {
      if (String(c.subject || '').trim() !== su || String(c.predicate || '').trim() !== pr) continue
      if (!best || Number(c.lastSeen || 0) > Number(best.lastSeen || 0)) best = c
    }
    return best
  }

  /** 按归一化文本找同一条记忆（同一句话被抽成多面时用） */
  findByText(text) {
    const key = String(text || '').replace(/\s+/g, '').toLowerCase()
    if (!key) return null
    for (const c of this.cells.values()) {
      if (String(c.text || '').replace(/\s+/g, '').toLowerCase() === key) return c
    }
    return null
  }

  get(id) {
    return this.cells.get(id) || null
  }

  find(key) {
    const id = this.byKey.get(key)
    const c = id ? this.cells.get(id) || null : null
    return c && !c.archived ? c : null
  }

  /** 同主体+同谓词的第一条（用于冲突检测；不要求客体相同）。 */
  findByPredicate(subject, predicate) {
    for (const c of this.cells.values()) {
      if (c.retracted || c.archived) continue
      if (c.subject === subject && c.predicate === predicate) return c
    }
    return null
  }

  /** 写入一条 cell；默认落盘（只追加，读时后者覆盖前者）。 */
  put(cell, { persist = true } = {}) {
    // 抽象层级（instance/type/rule）以前只在 levels.js 里算一下就不见了，
    // 落库后皮层才真的有多层，而不是一个平铺的事实表。
    if (!cell.level) {
      try { cell.level = levelOf(cell) } catch { cell.level = 'instance' }
    }
    if (cell.level && cell.level !== 'instance' && !Array.isArray(cell.supports)) {
      const kids = []
      for (const c of this.cells.values()) {
        if (!c || c.id === cell.id) continue
        if (c.level !== 'instance') continue
        if (c.predicate !== cell.predicate) continue
        kids.push(c.id)
      }
      if (kids.length) cell.supports = kids.slice(0, 20)
    }
    const prev = this.cells.get(cell.id)
    if (prev) touch(cell, { version: Math.max(prev.version || 1, cell.version || 1) })
    this.cells.set(cell.id, cell)
    this.byKey.set(cellKey(cell), cell.id)
    if (persist) void appendJsonl(FILES.cells, cell)
    return cell
  }

  /**
   * 回填：给已经有 level 但没有 supports 的条目补上支撑它的实例。
   * 为什么需要：supports 是在 put() 里算的，而库里这批 type/rule 是在这段代码之前写进去的，
   * 它们永远不会再被 put 一次，所以 supports 会一直是空的。这个方法只补缺、不动已有值。
   */
  async backfillSupports() {
    const changed = []
    for (const cell of this.cells.values()) {
      if (!cell || cell.retracted) continue
      if (!cell.level || cell.level === 'instance') continue
      if (Array.isArray(cell.supports) && cell.supports.length) continue
      const kids = []
      for (const c of this.cells.values()) {
        if (!c || c.id === cell.id) continue
        if (c.level !== 'instance') continue
        if (c.predicate !== cell.predicate) continue
        kids.push(c.id)
      }
      if (!kids.length) continue
      cell.supports = kids.slice(0, 20)
      cell.updatedAt = Date.now()
      changed.push(cell)
    }
    for (const c of changed) await appendJsonl(FILES.cells, c)
    return changed.map((c) => c.id)
  }

  remove(id) {
    const cell = this.cells.get(id)
    if (!cell) return null
    this.cells.delete(id)
    this.byKey.delete(cellKey(cell))
    void appendJsonl(FILES.cells, { ...cell, retracted: true, state: 'retracted', deletedAt: Date.now() })
    return cell
  }

  addEdge(from, to, kind, w = 1) {
    if (!from || !to || from === to) return null
    const hit = this.graph.find((e) => e.from === from && e.to === to && e.kind === kind)
    if (hit) {
      hit.w += w
      hit.at = Date.now()
      void appendJsonl(FILES.graph, hit)
      return hit
    }
    const edge = { from, to, kind, w, at: Date.now() }
    this.graph.push(edge)
    void appendJsonl(FILES.graph, edge)
    return edge
  }

  neighbors(id, hops = 1) {
    let frontier = new Set([id])
    const seen = new Set([id])
    for (let h = 0; h < hops; h++) {
      const next = new Set()
      for (const e of this.graph) {
        if (frontier.has(e.from) && !seen.has(e.to)) { seen.add(e.to); next.add(e.to) }
        if (frontier.has(e.to) && !seen.has(e.from)) { seen.add(e.from); next.add(e.from) }
      }
      frontier = next
      if (!frontier.size) break
    }
    return [...seen].filter((x) => x !== id)
  }

  edgesOf(id) {
    return this.graph.filter((e) => e.from === id || e.to === id)
  }

  loadFrom(cells = [], graph = []) {
    this.cells.clear()
    this.byKey.clear()
    for (const c of cells) {
      const cell = normalizeCell(c)
      this.cells.set(cell.id, cell)
      this.byKey.set(cellKey(cell), cell.id)
    }
    this.graph = graph.map((e) => ({ ...e }))
  }

  stats() {
    const list = this.allCells()
    return {
      total: list.length,
      facts: list.filter((c) => c.state === 'fact').length,
      hypotheses: list.filter((c) => c.state === 'hypothesis').length,
      retracted: list.filter((c) => c.retracted).length,
      episodic: list.filter((c) => c.layer === 'episodic').length,
      semantic: list.filter((c) => c.layer === 'semantic').length,
      inference: list.filter((c) => c.layer === 'inference').length,
      edges: this.graph.length,
      conflicts: this.conflicts.length,
    }
  }
}
