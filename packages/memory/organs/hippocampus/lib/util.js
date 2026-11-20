// 通用工具：时间、哈希、文本清洗、噪声过滤。
// 对应功能总表：L0-3 时区切段、L0-4 噪声过滤、L2-7 时间细胞。
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

export function nowIso() {
  return new Date().toISOString()
}

/** 本地日（切段与分卷都按本地时区，R 切段：跨天强制断）。 */
export function localDay(ts = Date.now()) {
  const d = new Date(ts)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${dd}`
}

/** 小时桶：指纹分桶用（L1-15 指纹索引）。 */
export function hourBucket(ts = Date.now()) {
  return `${localDay(ts)}T${String(new Date(ts).getHours()).padStart(2, '0')}`
}

/** 本地 HH:MM。 */
export function clockText(ts = Date.now()) {
  const d = new Date(ts)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

export function clamp(n, min, max) {
  const v = Number(n)
  if (!Number.isFinite(v)) return min
  return Math.max(min, Math.min(max, v))
}

/** 压平空白并截断。 */
export function clean(text, max = 1200) {
  return String(text ?? '').replace(/\s+/g, ' ').trim().slice(0, max)
}

/** 从任意事件结构里取文本（DSH 的 message/content/blocks 三种形态）。 */
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

// 系统灌进来的字不是记忆（L0-4 噪声过滤）。
// 这些字符串出现，就说明这条是壳子/通知，不是谁真的说了什么。
const NOISE_MARKERS = [
  'Current runtime context. This snapshot supersedes earlier runtime-context snapshots.',
  'Approval prompts are disabled in this session',
  '<system-reminder>',
  '<goal_',
  '<compacted-summary>',
  'available skill catalog changed',
  'Time sampled while preparing',
  'Browser time zone for this request',
  'Elapsed since the preceding',
  'This is an automatically generated checkpoint condensing an earlier span',
  '[model changed:',
  'You are repeating the exact same tool call',
  '<tool_call_error>',
  'Background job',
  '【这个抽屉：',
  '【当前交接',
  '【手边的工具',
  '【主人】',
  '【她是谁',
  '【Companion 记忆】',
  '【小鱼此刻的生活',
  '配图看情绪',
  '我亲手记下的（手抄本',
]

export function isNoise(text) {
  const s = String(text ?? '')
  if (!s.trim()) return true
  for (const marker of NOISE_MARKERS) if (s.includes(marker)) return true
  // 助手草稿：**Evaluating** / **Planning** / **Inspecting** 这类内心独白
  if (/^\s*\*\*[A-Z][a-z]+\*\*/.test(s)) return true
  if (/^\s*(?:Background )?(?:Subagent|Agent)\s+[0-9a-f-]{8,}/.test(s)) return true
  return false
}

/** 只存“真的说出口的话”：用户原话，或助手最终回复。 */
export function isStorable(role, text) {
  if (role !== 'user' && role !== 'assistant') return false
  if (!text) return false
  return !isNoise(text)
}

/** 稳定序列化：键排序，用于幂等 key。 */
export function stableJson(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`
  const keys = Object.keys(value).sort()
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableJson(value[k])}`).join(',')}}`
}

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * 把上游传来的 text 归一成字符串。
 * 背景：实测有 3 条 raw 写成 "[object Object]"（调用方把对象当 text 传进来），
 * 被当成记忆存下、还蒸了一遍。这里统一拆包，拆不出人话就返回 ''，由调用方拒绝。
 */
export function coerceText(v) {
  if (typeof v === 'string') return v
  if (typeof v === 'number' || typeof v === 'boolean') return String(v)
  if (Array.isArray(v)) return v.map((x) => coerceText(x)).filter(Boolean).join('\n')
  if (v && typeof v === 'object') {
    for (const k of ['text', 'content', 'summary', 'message', 'value']) {
      const got = coerceText(v[k])
      if (got) return got
    }
    return ''
  }
  return ''
}
