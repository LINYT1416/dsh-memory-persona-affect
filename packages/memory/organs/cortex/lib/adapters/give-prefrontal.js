// 下游 · 前额叶（F39）：把内容交回去，供来源校验和冲突检测。
// 前额叶不在就标低置信，不假装校验过。

export async function verifyWith(adapters, items) {
  if (!adapters?.prefrontal?.available) {
    return { accepted: items, rejected: [], reasons: ['no-prefrontal'], verified: false }
  }
  const out = await adapters.prefrontal.verify(items)
  if (!out) return { accepted: items, rejected: [], reasons: ['verify-timeout'], verified: false }
  return { ...out, verified: true }
}

export async function truthfulnessWith(adapters, text) {
  return adapters.prefrontal.truthfulness(text)
}
