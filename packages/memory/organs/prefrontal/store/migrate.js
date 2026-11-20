// #P5-11 数据迁移：账本格式一改，历史就不能读了。所以版本号必须落盘。
import { readJson, writeJson } from './jsonl.js'
import { FILES, VERSION } from './paths.js'

const MIGRATIONS = {
  // 0 → 1：最早没有 flags 字段
  1: (row) => ({ flags: [], ...row }),
}

export async function migrate() {
  const meta = (await readJson(FILES.meta, null)) || { store: 0, at: 0 }
  if (meta.store === VERSION.store) return { ok: true, from: meta.store, to: meta.store, changed: false }

  let from = Number(meta.store) || 0
  while (from < VERSION.store) {
    const step = MIGRATIONS[from + 1]
    if (!step) break
    from += 1
  }
  await writeJson(FILES.meta, { ...meta, store: VERSION.store, contract: VERSION.contract, at: Date.now(), migratedFrom: meta.store })
  return { ok: true, from: meta.store, to: VERSION.store, changed: true, rowTransform: Boolean(MIGRATIONS[1]) }
}

export async function meta() {
  return (await readJson(FILES.meta, null)) || { store: VERSION.store, contract: VERSION.contract }
}
