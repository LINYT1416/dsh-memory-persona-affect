// 通用工具：哈希、时间、文本切分、分词、否定检测。
// 对应：F12 相对顺序、F20 抽取前置、F24 偏差检测、F33 匹配。
import { createHash } from 'node:crypto'

export const MINUTE = 60 * 1000
export const HOUR = 60 * MINUTE
export const DAY = 24 * HOUR

export function sha1(text) {
  return createHash('sha1').update(String(text ?? '')).digest('hex')
}

export function sha16(text) {
  return sha1(text).slice(0, 16)
}

export function localDay(ts = Date.now()) {
  const d = new Date(ts)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function clockText(ts = Date.now()) {
  const d = new Date(ts)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

export function clamp(n, min, max) {
  const v = Number(n)
  if (!Number.isFinite(v)) return min
  return Math.max(min, Math.min(max, v))
}

export function clean(text, max = 600) {
  return String(text ?? '').replace(/\s+/g, ' ').trim().slice(0, max)
}

/** 从任意事件结构里取文本（和 DSH 的 message/content/blocks 三形态兼容）。 */
export function textOf(value) {
  if (!value) return ''
  if (typeof value === 'string') return value
  if (Array.isArray(value)) return value.map(textOf).filter(Boolean).join(' ')
  if (typeof value !== 'object') return ''
  if (typeof value.text === 'string') return value.text
  if (typeof value.content === 'string') return value.content
  if (Array.isArray(value.content)) return value.content.map(textOf).filter(Boolean).join(' ')
  if (Array.isArray(value.blocks)) return value.blocks.map(textOf).filter(Boolean).join(' ')
  if (value.message) return textOf(value.message)
  return ''
}

const NOISE = [
  'Current runtime context.',
  'Approval prompts are disabled',
  '<system-reminder>',
  '<goal_',
  '【这个抽屉：',
  '【当前交接',
  '【手边的工具',
  '【主人】',
  '【她是谁',
  '【Companion 记忆】',
  '【小鱼此刻的生活',
]

export function isNoise(text) {
  const s = String(text ?? '')
  if (!s.trim()) return true
  for (const m of NOISE) if (s.includes(m)) return true
  if (/^\s*\*\*[A-Z][a-z]+\*\*/.test(s)) return true
  return false
}

/** 切句：中英文标点都认。 */
export function sentences(text) {
  return String(text ?? '')
    .split(/[。！？!?；;\n]+/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 3)
}

const STOP = new Set(['的', '了', '是', '我', '你', '他', '她', '它', '在', '有', '和', '就', '都', '也', '这', '那', '一个', '一下', '什么', '怎么', '然后', '还有'])

/** 无分词器的中文切词：英文词 + 数字 + 汉字 2/3-gram。 */
export function tokenize(text) {
  const s = String(text ?? '')
    .toLowerCase()
    // 中英混排归一：B 站 / B站、QQ 机器人 / qq机器人 切成同一套
    .replace(/([a-z0-9])\s+([\u4e00-\u9fa5])/g, '$1$2')
    .replace(/([\u4e00-\u9fa5])\s+([a-z0-9])/g, '$1$2')
  const out = new Set()
  for (const w of s.match(/[a-z0-9_]+/g) || []) {
    if (w.length >= 2) out.add(w)
  }
  const cjk = s.replace(/[^a-z0-9\u4e00-\u9fa5]+/g, ' ')
  for (const run of cjk.split(/\s+/)) {
    if (!run) continue
    if (run.length >= 2 && !STOP.has(run)) out.add(run)
    for (let i = 0; i + 1 < run.length; i++) {
      const bi = run.slice(i, i + 2)
      if (!STOP.has(bi)) out.add(bi)
    }
    for (let i = 0; i + 2 < run.length; i++) {
      const tri = run.slice(i, i + 3)
      if (!STOP.has(tri)) out.add(tri)
    }
  }
  return [...out]
}

/** Jaccard 相似度，两段文本。 */
export function similarity(a, b) {
  const A = new Set(tokenize(a))
  const B = new Set(tokenize(b))
  if (!A.size || !B.size) return 0
  let inter = 0
  for (const x of A) if (B.has(x)) inter += 1
  return inter / (A.size + B.size - inter)
}

const NEGATIVE = ['不', '没', '别', '讨厌', '烦', '受不了', '不想', '拒绝', '讨厌死']

/** 否定/反向检测：用于 F24 偏差、F28 抗污染。 */
export function isNegative(text) {
  const s = String(text ?? '')
  return NEGATIVE.some((n) => s.includes(n))
}

/** 稳定序列化：幂等 key 用。 */
export function stableJson(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`
  const keys = Object.keys(value).sort()
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableJson(value[k])}`).join(',')}}`
}

export function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms))
}
