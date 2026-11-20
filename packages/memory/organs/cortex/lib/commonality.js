// 共性提取（F21）：多次经历提共性，偶性丢弃。
// 规则版：同主体+同谓词出现 ≥N 个不同客体 → 升一条“规律”型 cell。
export function groupByPredicate(cells) {
  const map = new Map()
  for (const c of cells) {
    if (c.retracted) continue
    // 提炼出来的概念不能再喂回去，否则每轮都把上一轮的结果再合一次（自我繁殖）
    if (c.kind === 'concept') continue
    if (Array.isArray(c.tags) && c.tags.includes('pattern')) continue
    const key = `${c.subject}|${c.predicate}`
    if (!map.has(key)) map.set(key, [])
    map.get(key).push(c)
  }
  return map
}

/** 只有偏好类谓词能提炼成“规律”；计划/正在做/经历凑一起只会变成一句废话。 */
const PATTERN_PREDICATES = new Set(['喜欢', '讨厌', '偏好', '习惯', '爱', '不喜欢'])

/** 找共性：同谓词、不同客体、≥min 个 → 一条 rule。 */
export function findPatterns(cells, { min = 3 } = {}) {
  const out = []
  for (const [key, group] of groupByPredicate(cells)) {
    const predicate = key.split('|')[1]
    if (!PATTERN_PREDICATES.has(predicate)) continue
    const norm = (o) => String(o || '').replace(/[\s，,。；;、]+$/g, '').replace(/\s+/g, '')
    const objects = [...new Set(group.map((c) => norm(c.object)).filter(Boolean))]
    if (objects.length < min) continue
    const [subject] = key.split('|')
    // 先按"共享 2 字词"聚类：只有真正相关的才算同一类，凑不够就不升
    const clusters = []
    for (const obj of objects) {
      const grams = new Set()
      for (let i = 0; i + 1 < obj.length; i++) grams.add(obj.slice(i, i + 2))
      let hit = null
      for (const c of clusters) {
        if ([...grams].some((g) => c.grams.has(g))) { hit = c; break }
      }
      if (hit) {
        hit.objects.push(obj)
        for (const g of grams) hit.grams.add(g)
      } else {
        clusters.push({ objects: [obj], grams })
      }
    }
    const merged = clusters.filter((c) => c.objects.length >= min).map((c) => c.objects)
    if (!merged.length) continue
    for (const objs of merged) {
      out.push({
      kind: 'concept',
      subject,
      predicate,
        object: objs.join('、'),
        text: `${subject}${predicate}：${objs.join('、')}`,
        source: 'inferred',
        confidence: 0.55,
        supportIds: group.filter((c) => objs.includes(c.object)).flatMap((c) => c.supportIds || []),
        evidenceCount: objs.length,
        tags: ['pattern'],
      })
    }
  }
  return out
}

/** 同一件事的多条证据合并（去重支撑 id）。 */
export function mergeEvidence(cells) {
  return {
    supportIds: [...new Set(cells.flatMap((c) => c.supportIds || []))],
    evidenceCount: new Set(cells.flatMap((c) => c.supportIds || [])).size || cells.length,
    lastSeen: Math.max(0, ...cells.map((c) => c.lastSeen || 0)),
  }
}

/**
 * 规律层（文档 §2.2 / §2.8 的顶层）：同一个 subject+predicate+object
 * 在不同日子反复出现 ≥ minDays 次，才升成一条 rule。
 *
 * 两条硬约束：
 * 1) 稳定 id —— 同一条规律每次重算都落到同一个 cell，不会越长越多
 * 2) 不拿 pattern/concept 当原料 —— 否则又是自我繁殖
 */
export function findRules(cells, { minDays = 3, minSpanMs = 2 * 86400000, now = Date.now() } = {}) {
  const groups = new Map()
  for (const c of cells) {
    if (!c || c.retracted) continue
    if (c.kind === 'concept') continue
    if (Array.isArray(c.tags) && c.tags.includes('pattern')) continue
    const subj = String(c.subject || '').trim()
    const pred = String(c.predicate || '').trim()
    const obj = String(c.object || '').trim().replace(/[\s，,。；;、]+$/g, '')
    if (!subj || !pred || !obj) continue
    if (pred === '正在做' || pred === '计划') continue   // 一次性的事不构成规律
    const key = subj + '|' + pred + '|' + obj
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(c)
  }

  const out = []
  for (const [key, group] of groups) {
    const days = new Set()
    let minAt = Infinity
    let maxAt = 0
    for (const c of group) {
      const t = Number(c.lastSeen || c.firstSeen || 0)
      if (!t) continue
      days.add(new Date(t).toISOString().slice(0, 10))
      if (t < minAt) minAt = t
      if (t > maxAt) maxAt = t
    }
    if (days.size < minDays) continue
    if (maxAt - minAt < minSpanMs) continue
    const [subj, pred, obj] = key.split('|')
    out.push({
      id: 'rule_' + hash(key),
      kind: 'concept',
      level: 'rule',
      subject: subj,
      predicate: pred,
      object: obj,
      text: subj + pred + obj + '（反复出现 ' + days.size + ' 天）',
      source: 'inferred',
      state: 'fact',
      layer: 'semantic',
      confidence: 0.7,
      evidenceCount: group.length,
      supports: group.map((c) => c.id).slice(0, 20),
      supportIds: group.flatMap((c) => c.supportIds || []).slice(0, 50),
      tags: ['pattern', 'rule'],
      order: now,
    })
  }
  return out
}

function hash(str) {
  let h = 2166136261
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return (h >>> 0).toString(36)
}
