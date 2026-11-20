// 批边界（F18、R2、R18）：一批一起处理，不零散改；跨窗口就拆批。
export const BATCH = 20
export const DEEP_BATCH = 40

export function batchSize(mode = 'shallow') {
  return mode === 'deep' ? DEEP_BATCH : BATCH
}

export function takeBatch(items, mode = 'shallow') {
  return items.slice(0, batchSize(mode))
}

export function chunk(items, size = BATCH) {
  const out = []
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
  return out
}
