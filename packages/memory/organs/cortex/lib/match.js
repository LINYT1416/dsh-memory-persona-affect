// 皮层侧模式识别（F33、C3、R9）：精确匹配为主，补全归海马体。
import { similarity, tokenize } from './util.js'

/** 口语问法 → 索引里真实出现的谓词，避免“在忙什么”这种问法落空。 */
const ALIAS = {
  忙: ['正在做', '赶', '加班'],
  做什么: ['正在做', '计划'],
  干什么: ['正在做', '计划'],
  在干嘛: ['正在做'],
  最近: ['正在做'],
  喜欢: ['喜欢'],
  讨厌: ['讨厌'],
  // 问“家里出什么事了”时，记忆里通常写的是“住院/手术/裁人/出事”，不是“家里”
  家里: ['经历', '住院', '手术', '裁人', '出事', '生病'],
  出事: ['经历', '住院', '手术', '裁人'],
  出什么事: ['经历', '事件'],
  怎么了: ['经历'],
  发生什么: ['经历', '事件'],
}

/** 只返回“原句里没有”的同义/关联词；不要拼成长串（BM25 会被稀释）。 */
export function expandTerms(q) {
  const s = String(q || '')
  const out = []
  for (const [k, vs] of Object.entries(ALIAS)) {
    if (!s.includes(k)) continue
    for (const v of vs) {
      if (!s.includes(v) && !out.includes(v)) out.push(v)
    }
  }
  return out.slice(0, 8)
}

export function expandQuery(q) {
  const terms = expandTerms(q)
  return terms.length ? `${q} ${terms.join(' ')}` : String(q || '')
}

/** 自动判模式：有数字/引号 → 分离（精确），否则补全。 */
export function modeOf(query) {
  if (/["“”「」]|\d{3,}/.test(String(query || ''))) return 'separate'
  return 'complete'
}

export function scoreCell(query, tokens, cell) {
  const text = `${cell.text || ''} ${cell.subject || ''} ${cell.predicate || ''} ${cell.object || ''}`.toLowerCase()
  let score = 0
  for (const t of tokens) if (text.includes(t)) score += 1
  score += similarity(query, text) * 3
  const q = String(query || '')
  if (cell.object && q.includes(cell.object)) score += 2
  if (cell.state === 'fact') score += 0.5
  if (cell.state === 'hypothesis') score -= 0.2
  if (cell.biasFlag) score -= 0.3
  score *= 0.5 + 0.5 * (cell.confidence || 0.5)
  score *= 0.8 + 0.2 * Math.min(1.5, cell.weight || 1)
  return score
}

/** 检索：只读，不写。k 由调用方给。 */
/** 问什么就先把对应谓词/关键词的 cell 顶上来，别让“名字”问出“人格白纸”。 */
function intentBoost(query, cell) {
  const q = String(query || '')
  const text = String(cell.text || '')
  let b = 0
  if (/叫什么|名字|是谁/.test(q)) {
    if (cell.predicate === '名字') b += 2
    if (/示例用户/.test(text)) b += 1
  }
  if (/不喜欢|讨厌|烦/.test(q) && cell.predicate === '讨厌') b += 1.5
  if (/插件|装过/.test(q) && /插件/.test(text)) b += 1
  if (/喜欢/.test(q) && cell.predicate === '喜欢') b += 0.5
  return b
}

/** 问“家里”时，家人/住院类事件要比自己的事更靠前。 */
function familyBoost(query, text) {
  return /家里|家人/.test(query) && /(爸|妈|住院|手术|家人)/.test(text) ? 0.6 : 0
}

export function search(cells, query, { mode = 'auto', k = 5, floor = 0.9 } = {}) {
  const rawQuery = String(query || '')
  const m = mode === 'auto' ? modeOf(rawQuery) : mode
  const pool = cells.filter((c) => !c.retracted && !c.archived
    // 碎知识不参与检索：单独的“地点：楼下”这种条目只会制造假阳性
    && !(c.kind === 'place' && String(c.object || '').length < 3))

  // 一个词一路召回：原句 + 每个扩写词各算一次，取每条的 max，不拼长串
  const variants = [rawQuery, ...expandTerms(rawQuery)]
  const best = new Map()
  variants.forEach((v, vi) => {
    const tokens = tokenize(v)
    // 原句要够相关才进；扩写词是人工维护的，门槛放低一点，专门负责把漏的捞回来
    const minScore = vi === 0 ? floor : floor * 0.6
    for (const cell of pool) {
      const s = scoreCell(v, tokens, cell) + familyBoost(rawQuery, cell.text || '')
        + intentBoost(rawQuery, cell)
      if (s < minScore) continue
      // 原句优先一点点，扩写只负责把漏掉的捞回来
      const adj = vi === 0 ? s * 1.05 : s
      const cur = best.get(cell.id)
      if (!cur || adj > cur.score) best.set(cell.id, { cell, score: adj })
    }
  })

  const scored = [...best.values()].sort((a, b) => b.score - a.score)
  const maxScore = scored.length ? scored[0].score || 1 : 1
  const qTokens = tokenize(rawQuery)
  const hits = []
  for (const x of scored) {
    if (hits.length >= k) break
    if (m === 'separate') {
      const text = `${x.cell.text} ${x.cell.object}`.toLowerCase()
      if (!qTokens.some((t) => t.length >= 2 && text.includes(t))) continue
    }
    hits.push({
      cellId: x.cell.id,
      text: x.cell.text,
      kind: x.cell.kind,
      state: x.cell.state,
      source: x.cell.source || 'unknown',
      sourceEpisode: (x.cell.supportIds || [])[0] || '',
      score: Number(x.score.toFixed(4)),
      // 0~1 归一，跨查询可比；排序仍用原始分
      scoreNorm: Number((x.score / maxScore).toFixed(3)),
      confidence: Number(x.cell.confidence.toFixed(2)),
      // E5/E8：把 cell → episode 的映射带出来，海马体不用再反查
      supportIds: [...(x.cell.supportIds || [])],
      why: m === 'separate' ? ['exact'] : ['token', 'similar'],
    })
  }
  return { mode: m, hits }
}
