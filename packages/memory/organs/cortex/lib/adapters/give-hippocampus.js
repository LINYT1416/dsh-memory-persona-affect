// 下游 · 海马体（F38）：给线索、给被绑定的原始表征。
// 皮层不存原文，要细节时回海马体取。

export async function rawOf(adapters, episodeId) {
  if (!episodeId) return []
  return adapters.hippocampus.raw({ episodeId })
}

/** 一批 cell 对应的线索（给海马体做检索扩展用）。 */
export function cluesFor(store, ids = []) {
  return ids
    .map((id) => store.get(id))
    .filter(Boolean)
    .map((c) => ({ id: c.id, text: c.text, object: c.object, confidence: c.confidence }))
}
