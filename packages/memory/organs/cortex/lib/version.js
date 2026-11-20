// 版本与回滚（F13）：每次蒸馏前落快照，错了能退（R15：只回语义层）。
import { writeSnapshot, readSnapshot, listSnapshots, pruneSnapshots, writeMeta } from './store.js'

export async function snapshot(store, meta, keep = 10) {
  const seq = (meta.snapshotSeq || 0) + 1
  const payload = {
    at: Date.now(),
    seq,
    cursor: meta.cursor || 0,
    cells: store.allCells().map((c) => JSON.parse(JSON.stringify(c))),
    graph: store.graph.map((e) => ({ ...e })),
  }
  const path = await writeSnapshot(seq, payload)
  meta.snapshotSeq = seq
  await pruneSnapshots(keep)
  return { seq, path }
}

export async function rollback(store, name, meta = null) {
  // 不传 name = 列可用快照（工具说明里就是这么写的）。
  // 以前直接进 readSnapshot(undefined) → join(SNAP_DIR, undefined) 抛错，
  // "看看有哪些快照"这个基本用法一调就崩。
  if (!name) {
    const names = await listSnapshots()
    return { snapshots: names, count: names.length }
  }
  const snap = await readSnapshot(name)
  if (!snap) return null
  store.loadFrom(snap.cells || [], snap.graph || [])
  if (meta) {
    meta.cursor = snap.cursor ?? meta.cursor ?? 0
    meta.snapshotSeq = Math.max(0, (snap.seq || 1) - 1)
    await writeMeta(meta)
  }
  return { seq: snap.seq, at: snap.at, cells: snap.cells?.length || 0 }
}

export async function versions() {
  return listSnapshots()
}
