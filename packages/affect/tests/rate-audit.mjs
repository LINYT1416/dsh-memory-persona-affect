// 频率审计：把引擎里所有数值字段摊平，用"1 秒一拍 × N 拍"跑一遍
// 目的：抓住"按拍数涨、不按时间涨"的字段（饥饿 +0.05/拍、信任 +0.006/拍 就是这么漏出去的）
//
// 做法：先让它跑 10 分钟到平衡（刚启动本来就在往平衡点走，那不算 bug），
// 再测接下来 2 分钟的变化量。判据：2 分钟里单个字段变化应当很小。
//
//   node tests/rate-audit.mjs
import { createEngine } from '../core/engine.js'

const flat = (o, prefix = '', out = {}) => {
  if (o == null || typeof o !== 'object') {
    if (typeof o === 'number') out[prefix] = o
    return out
  }
  if (Array.isArray(o)) {
    o.forEach((v, i) => flat(v, `${prefix}[${i}]`, out))
    return out
  }
  for (const [k, v] of Object.entries(o)) flat(v, prefix ? `${prefix}.${k}` : k, out)
  return out
}

const SETTLE = 600      // 10 分钟平衡期
const TICKS = 120       // 测 2 分钟
const STEP = 1000

let t = new Date(2026, 10, 12, 15, 0, 0).getTime()
const e = createEngine({ now: () => t })
e.tick([])
for (let i = 0; i < SETTLE; i += 1) { t += STEP; e.tick([]) }
const before = flat(e.read())
for (let i = 0; i < TICKS; i += 1) { t += STEP; e.tick([]) }
const after = flat(e.read())

// 计数器与"设计上就随时间单调走"的量不算跳变
const IGNORE = /frame|^tick$|^at$|^ticks$|tx\.|trace|seed|count|\.id$/
// 这些字段本来就是"闲置越久越涨"，按分钟算的，允许
const RAMP = /mindWander|^idle$|socialImagining|idleMs/

const rows = []
for (const k of Object.keys(after)) {
  if (!(k in before) || IGNORE.test(k) || RAMP.test(k)) continue
  if (!Number.isFinite(before[k]) || !Number.isFinite(after[k])) continue
  const d = after[k] - before[k]
  if (Math.abs(d) > 0.0005) rows.push({ k, d })
}
rows.sort((a, b) => Math.abs(b.d) - Math.abs(a.d))

console.log(`平衡 10 分钟后，再用 1 秒一拍测 2 分钟；有变化的字段：`)
for (const r of rows.slice(0, 20)) console.log(`  ${r.d > 0 ? '+' : ''}${r.d.toFixed(5)}  ${r.k}`)
if (!rows.length) console.log('  （安静状态下没有字段在动，这是对的）')

const LIMIT = 0.02
// 单位不是 0~1 的字段要单独给尺子：毫秒、心率、呼吸
const limitOf = (k) => (/Ms$/.test(k) ? 500 : /body\.(hr|hrv|breath)$/.test(k) ? 5 : LIMIT)
const bad = rows.filter((r) => Math.abs(r.d) > limitOf(r.k))
if (bad.length) {
  console.log(`\nFAIL ${bad.length} 个字段在 2 分钟里变化超过各自阈值（像是按拍数在跳）：`)
  for (const b of bad) console.log(`  ${b.k}  Δ=${b.d.toFixed(4)}（阈值 ${limitOf(b.k)}）`)
  process.exit(1)
}
console.log(`\nPASS 没有字段按拍数跳变（2 分钟内变化都在各自阈值内）`)
process.exit(0)
