// 活性检查：跑一段真实节奏，看哪些状态从头到尾没变过（= 死变量）。
//   node tests/liveness.mjs
import { createEngine } from '../core/engine.js'

let clock = new Date('2026-11-11T09:00:00+08:00').getTime()
const engine = createEngine({ now: () => clock })

const script = [
  ['早啊，今天起晚了', 'user'],
  ['我买了杯咖啡，你喝吗', 'user'],
  ['中午吃了个面', 'user'],
  ['下午三点要开会，烦死了', 'user'],
  ['你行不行啊，这都做不好', 'user'],
  ['对不起，我刚才语气重了', 'user'],
  ['晚上一起看电影吧', 'user'],
]
const start = JSON.parse(JSON.stringify(engine.snapshot()))
const seen = new Map()   // path -> Set(JSON)

function record(snap) {
  for (const [id, s] of Object.entries(snap.organs)) {
    const lv = leaves(s || {}, id)
    for (const [k, v] of Object.entries(lv)) {
      if (!seen.has(k)) seen.set(k, new Set())
      seen.get(k).add(JSON.stringify(v))
    }
  }
}
record(start)

for (let i = 0; i < 60; i++) {
  clock += 15 * 60_000
  const turn = script[i % script.length]
  const events = i % 3 === 0 ? [{ type: turn[1], text: turn[0], at: clock }] : []
  engine.tick(events)
  if (i === 20) engine.organs.amygdala.inject({ vicarious: 1 })
  if (i === 30) { clock += 6 * 3600_000; engine.tick([]) }
  record(engine.snapshot())
}
const end = JSON.parse(JSON.stringify(engine.snapshot()))

function leaves(obj, path = '', out = {}) {
  if (obj && typeof obj === 'object' && !Array.isArray(obj)) {
    for (const [k, v] of Object.entries(obj)) leaves(v, path ? `${path}.${k}` : k, out)
  } else out[path] = obj
  return out
}

const dead = []
for (const [k, set] of seen) {
  if (k.endsWith('.frame')) continue
  if (set.size <= 1) dead.push(k)
}

console.log(`跑了 ${engine.state.ticks} 拍，${Math.round((clock - new Date('2026-11-11T09:00:00+08:00').getTime()) / 3600000)} 小时`)
console.log(`从未变化的状态字段：${dead.length} 个`)
for (const d of dead) console.log('  -', d)
console.log(`\nmood ${start.mood.toFixed(3)} → ${end.mood.toFixed(3)}`)
process.exit(0)
