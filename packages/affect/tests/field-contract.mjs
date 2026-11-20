// 字段契约：每个"对外读出但没人用"的字段，必须有一个明确的说法。
//
// 规则（这次是硬的）：
//   1. read() 里露出来、全代码没人读的字段，必须在 docs/field-contract.json 里有条目
//   2. 条目状态只能是 internal（有意留存，给 dashboard/调试看）/ planned（该接还没接）/ exported（外部插件用）
//   3. planned 有预算：只能往下减，加了新账就红
//
// 这不是文档作业——它挡住的是"又算了一个数、又没人用"这种慢性病。
//
//   node tests/field-contract.mjs
import { readdirSync, readFileSync, statSync, writeFileSync, mkdirSync } from 'node:fs'
import { join, basename, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const CONTRACT = join(ROOT, 'docs', 'field-contract.json')
const SKIP = new Set(['tests', 'node_modules', 'docs'])

const files = []
;(function walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) { if (!SKIP.has(name)) walk(p); continue }
    if (name.endsWith('.js') && !SKIP.has(name)) files.push(p)
  }
})(ROOT)
const src = new Map(files.map((f) => [f, readFileSync(f, 'utf8')]))

const { createEngine } = await import('file://' + join(ROOT, 'core', 'engine.js').replace(/\\/g, '/'))
const e = createEngine({})
e.tick([{ type: 'user', text: '嗯', at: Date.now() }], 'a')

const DEF = {
  amygdala: 'organs/amygdala.js', hypothalamus: 'organs/hypothalamus.js', insula: 'organs/insula.js',
  hippocampus: 'organs/hippocampus.js', pfc: 'organs/pfc.js', neuromod: 'layers/neuromod.js',
  attention: 'layers/attention.js', social: 'layers/social.js', brainstem: 'supplements/brainstem.js',
  dmn: 'supplements/dmn.js', endocrine: 'supplements/endocrine.js', sickness: 'supplements/sickness.js',
  curve: 'time/curve.js', rhythm: 'time/rhythm.js', bias: 'io/bias.js', io: 'io/output.js',
}

const flatten = (o, prefix = '', out = {}) => {
  if (!o || typeof o !== 'object') return out
  for (const [k, v] of Object.entries(o)) {
    const p = prefix ? `${prefix}.${k}` : k
    if (v && typeof v === 'object' && !Array.isArray(v)) flatten(v, p, out)
    else out[p] = v
  }
  return out
}

const zeros = []
for (const [id, mod] of Object.entries(e.organs)) {
  if (!mod?.snapshot) continue
  const surface = typeof mod.read === 'function' ? mod.read() : mod.snapshot()
  for (const path of Object.keys(flatten(surface))) {
    if (path === 'frame' || path === 'id') continue
    const field = path.split('.').pop()
    if (field.length < 3) continue
    const re = new RegExp(`(?:[.?]|\\[['"])${field}\\b`)
    let used = false
    for (const [f, text] of src) {
      if (basename(f) === basename(DEF[id])) continue
      if (re.test(text)) { used = true; break }
    }
    if (!used) zeros.push(`${id}.${path}`)
  }
}

// ── 契约 ────────────────────────────────────────────────
let doc
try { doc = JSON.parse(readFileSync(CONTRACT, 'utf8')) } catch { doc = { meta: { plannedBudget: 0 }, fields: {} } }
doc.fields ||= {}
doc.meta ||= { plannedBudget: 0 }

// 初判：按器官给默认的说法（不是为了糊，是为了第一次跑能看见全貌）
const DEFAULT_STATUS = {
  pfc: 'internal', insula: 'internal', hypothalamus: 'internal',
  dmn: 'internal', attention: 'internal', neuromod: 'internal', social: 'internal',
  curve: 'internal', brainstem: 'internal', endocrine: 'internal', sickness: 'internal',
  rhythm: 'internal', bias: 'internal', amygdala: 'internal', hippocampus: 'internal',
  io: 'planned',
}
const DEFAULT_WHY = {
  internal: '内部状态量：参与自身推算/持久化，或给 dashboard 观察；不进注入文本（进了就把内心活动写成说明书）',
  planned: '输出通道算出但还没接进文本，属于欠账',
}

const added = []
for (const key of zeros) {
  if (doc.fields[key]) continue
  const organ = key.split('.')[0]
  doc.fields[key] = { status: DEFAULT_STATUS[organ] || 'internal', why: DEFAULT_WHY[DEFAULT_STATUS[organ] || 'internal'] }
  added.push(key)
}

// 清掉已经不存在的条目（字段被删了，契约也要跟着走）
const zeroSet = new Set(zeros)
const stale = Object.keys(doc.fields).filter((k) => !zeroSet.has(k))
for (const k of stale) delete doc.fields[k]

const planned = Object.entries(doc.fields).filter(([, v]) => v.status === 'planned').map(([k]) => k)
const bad = Object.entries(doc.fields).filter(([, v]) => !['internal', 'planned', 'exported'].includes(v.status))

mkdirSync(dirname(CONTRACT), { recursive: true })
writeFileSync(CONTRACT, JSON.stringify(doc, null, 1), 'utf8')

const fails = []
// 新冒出来的无人用字段一律红：自动化只能给个临时说法，真正"该留还是该撤"得人来定。
if (added.length) {
  fails.push(`新出现 ${added.length} 个无人用字段，需要逐个确认：${added.slice(0, 6).join(', ')}${added.length > 6 ? ' …' : ''}`)
}if (bad.length) fails.push(`状态非法的条目 ${bad.length}：${bad.slice(0, 5).map(([k]) => k).join(', ')}`)
if (planned.length > doc.meta.plannedBudget) {
  fails.push(`planned 超预算：${planned.length} > ${doc.meta.plannedBudget}（新欠账：${added.join(', ') || '见上'}`)
}

if (fails.length) {
  console.log(`FAIL ${fails.length}:`)
  for (const f of fails) console.log(' - ' + f)
  console.log(`\n契约写在 ${CONTRACT}；把该接的接上、该撤的撤掉，然后把 meta.plannedBudget 往下调。`)
  process.exit(1)
}
console.log(`PASS 字段契约（read() 无消费者 ${zeros.length} 个，全部有说法；planned ${planned.length}/${doc.meta.plannedBudget}；过时条目清掉 ${stale.length} 个）`)
process.exit(0)
