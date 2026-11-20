// BM25 检索（分离模式的精确路 + 补全模式的一路）。
// 对应功能总表：L3-1 补全、L3-2 双模式、L2-9 召回理由。

import { tokenize, docLen, extractEntities } from './taxonomy.js'

// 同义扩写：字面不重合时补说法（中文没有词根，靠这张表）
const ALIAS = [
  [/(账号|uid|\bid\b)/i, ['uid', '昵称', '账号']],
  [/(名字|叫什么|昵称)/i, ['昵称', '名字']],
  [/(心情|情绪|状态)/i, ['心情', '情绪', '心境']],
  [/(日程|安排|计划)/i, ['日程', '安排', '计划']],
  [/(吃|喝|口味)/i, ['喜欢', '吃', '喝']],
  [/(住|家|哪)/i, ['住', '家']],
  [/(记忆|记性|忘)/i, ['记忆', '记得', '忘']],
  [/(语音|声音|嗓子)/i, ['语音', '声音']],
  [/(插件|程序)/i, ['插件', '程序']],
]

export function expandQuery(text) {
  const s = String(text || '')
  const extra = []
  for (const [re, words] of ALIAS) if (re.test(s)) extra.push(...words)
  return extra.length ? `${s} ${extra.join(' ')}` : s
}

const STOP = new Set(['的', '了', '是', '在', '有', '和', '与', '就', '都', '也', '我', '你', '他', '她', '这', '那'])

function contentTokens(text) {
  const out = new Set()
  for (const [tok] of tokenize(text)) {
    if (tok.length < 2) continue
    if (STOP.has(tok)) continue
    out.add(tok)
  }
  return [...out]
}

function entityBoost(query, row) {
  const toks = contentTokens(query)
  if (!toks.length) return 0
  const hay = `${row.summary || ''} ${(row.entities || []).join(' ')} ${(row.keywords || []).join(' ')}`.toLowerCase()
  let hit = 0
  for (const t of toks) if (hay.includes(t.toLowerCase())) hit += 1
  let boost = 0.35 * hit * (0.5 + 0.5 * (hit / toks.length))
  if (/账号|uid|号码|编号|电话/i.test(query) && /\d{6,}/.test(hay)) boost += 1.2
  return boost
}

/** 用 index 行建 BM25。 */
export function makeBm25(rows, { k1 = 1.5, b = 0.75 } = {}) {
  const docs = rows.map((row) => {
    const text = `${row.summary || ''} ${(row.entities || []).join(' ')} ${(row.keywords || []).join(' ')}`
    return { row, text, tokens: tokenize(text), len: 0 }
  })
  let total = 0
  const df = new Map()
  for (const d of docs) {
    d.len = docLen(d.tokens)
    total += d.len
    for (const t of new Set(d.tokens.keys())) df.set(t, (df.get(t) || 0) + 1)
  }
  const N = docs.length || 1
  const avgdl = total / N || 1

  return {
    rows,
    search(query, topK = 20) {
      const q = tokenize(expandQuery(query))
      const out = []
      for (const d of docs) {
        let s = 0
        for (const [t, qc] of q) {
          const f = d.tokens.get(t)
          if (!f) continue
          const n = df.get(t) || 0
          const idf = Math.log(1 + (N - n + 0.5) / (n + 0.5))
          s += (idf * (f * (k1 + 1))) / (f + k1 * (1 - b + b * (d.len / avgdl))) * Math.min(qc, 3)
        }
        if (s > 0) out.push({ id: d.row.episodeId, score: s * (1 + 0.9 * entityBoost(query, d.row)), why: 'bm25' })
      }
      out.sort((a, b2) => b2.score - a.score)
      return out.slice(0, topK)
    },
  }
}

/** 分离模式的精确命中：数字串、引号原话、完整实体。 */
export function exactHits(rows, query) {
  const s = String(query || '')
  const keys = []
  for (const m of s.matchAll(/\d{4,}/g)) keys.push(m[0])
  for (const m of s.matchAll(/[「『"“]([^」』"”]{2,20})[」』"”]/g)) keys.push(m[1])
  for (const m of s.matchAll(/@([^\s@]{1,20})/g)) keys.push(m[1])
  const ents = extractEntities(s).filter((e) => e.length >= 2)
  keys.push(...ents)

  if (!keys.length) return []
  const out = []
  for (const row of rows) {
    const hay = `${row.summary || ''} ${(row.entities || []).join(' ')}`
    let hit = 0
    for (const k of keys) if (hay.includes(k)) hit += 1
    if (hit) out.push({ id: row.episodeId, score: hit * 2, why: `exact:${hit}` })
  }
  out.sort((a, b) => b.score - a.score)
  return out
}
