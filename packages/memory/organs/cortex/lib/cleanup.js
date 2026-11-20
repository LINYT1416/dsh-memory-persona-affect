// 数据清理：抽取规则升级时跑一次。
// 只归档“旧规则产出的垃圾”，不碰正常条目；上一版误归档的 hypothesis 会被放回来。
import { isThreatText } from './extract.js'
import { MULTI_VALUED } from './anti-pollution.js'
import { appendJsonl, FILES } from './store.js'

export const PATTERN_OK = new Set(['喜欢', '讨厌', '偏好', '习惯', '爱', '不喜欢'])
const KIND_RANK = { event: 6, fact: 5, preference: 4, relation: 3, place: 1 }

export function cleanupCells(store) {
  let changed = 0
  const cells = store.allCells()
  // 同一 episode + 同一句话：只有 event 存在时才收掉 fact/relation（一句话可含多个事实）
  const groups = new Map()
  for (const c of cells) {
    if (c.retracted) continue
    const key = `${c.text}|${(c.supportIds || []).join(',')}`
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(c)
  }
  const losers = new Set()
  for (const group of groups.values()) {
    const ev = group.find((c) => c.kind === 'event')
    if (!ev) continue
    for (const c of group) {
      if (c === ev) continue
      if (c.kind === 'relation' || c.predicate === '正在做') losers.add(c.id)
    }
  }
  for (const c of cells) {
    const tags = c.tags || []
    let dirty = false
    // 上一版把 hypothesis 全归档了：先放回来，再按规则重新判
    if (c.state === 'hypothesis' && c.archived) { c.archived = false; dirty = true }
    // 重复 cell
    if (losers.has(c.id)) { c.archived = true; dirty = true }
    // 碎地点
    if (tags.includes('place') || c.kind === 'place') { c.archived = true; dirty = true }
    // 把“被裁员”错抽成计划的旧条目
    if (c.predicate === '计划' && isThreatText(c.text)) { c.archived = true; dirty = true }
    // 非偏好凑出来的规律
    if (tags.includes('pattern') && !PATTERN_OK.has(c.predicate)) { c.archived = true; dirty = true }
    // 测试残留
    if (/（可删）|^\s*测试[：:]/.test(String(c.text || ''))) { c.archived = true; dirty = true }
    if (dirty) {
      store.put(c)
      changed += 1
    }
  }
  // 误判的冲突：事件 / 主体不同 → 标 stale，不再挂在 open 队列里
  for (const cf of store.conflicts || []) {
    if (cf.state !== 'open') continue
    const a = store.get(cf.aId)
    const b = store.get(cf.bId)
    if (!a || !b) continue
    if (a.kind === 'event' || b.kind === 'event' || a.subject !== b.subject
      || MULTI_VALUED.has(a.predicate) || MULTI_VALUED.has(b.predicate)) {
      cf.state = 'stale'
      cf.reason = `${cf.reason || 'value-mismatch'}:event-or-subject`
      void appendJsonl(FILES.conflicts, cf)
      changed += 1
    }
  }
  return changed
}
