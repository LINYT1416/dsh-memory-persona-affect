// 分区（F03）：感觉细节 / 概念 / 关系 / 索引 / 控制。
// zone 是内容类型，和 layer（保真度）正交（R12）。
export const ZONES = ['sensory', 'concept', 'relation', 'index', 'control']

const BY_KIND = {
  fact: 'concept',
  preference: 'concept',
  trait: 'concept',
  relation: 'relation',
  place: 'sensory',
  concept: 'concept',
  event_ref: 'index',
}

export function zoneOf(kind) {
  return BY_KIND[kind] || 'concept'
}

export function isZone(z) {
  return ZONES.includes(z)
}

export function groupByZone(cells) {
  const out = { sensory: [], concept: [], relation: [], index: [], control: [] }
  for (const c of cells) (out[c.zone] || out.concept).push(c)
  return out
}
