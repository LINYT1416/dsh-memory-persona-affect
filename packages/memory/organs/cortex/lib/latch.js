// 锁存落盘（F16、R2）：批内积攒，批尾统一 commit；崩溃整批丢，不留半批。
import { writeMeta } from './store.js'

export async function commit(store, meta, { batch = 0, promoted = 0, conflicts = 0, mode = 'shallow' } = {}) {
  meta.lastDistillAt = Date.now()
  meta.stats = store.stats()
  await writeMeta(meta)
  return { committed: true, at: meta.lastDistillAt, batch, promoted, conflicts, mode }
}
