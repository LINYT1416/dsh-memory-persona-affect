// 规格审计：不看"写了没"，看"这一项换个值，外面有没有跟着变"。
//   node tests/spec.mjs
// 做法：包住模块的 read()，把某一个字段改成极端值，跑同一句话，
// 看输出签名（情绪/心情/句长/标点/表情包/注入文案）变不变。
// 这样绕开"step 会重算内部状态"的问题——我们测的是"这个读数有没有人用"。
import { createEngine } from '../core/engine.js'
import { render } from '../core/inject.js'

const MSG = '你行不行啊，说了几遍还是崩，我真的很失望'
const T0 = new Date('2026-11-12T20:00:00+08:00').getTime()

function signature(f) {
  return JSON.stringify({
    mood: Number(f.mood.toFixed(3)),
    emo: (f.emotions || []).map(x => x.kind + ':' + Number(x.intensity).toFixed(2)).join(','),
    felt: Number(f.felt?.intensity ?? 0).toFixed(2),
    brev: Number(f.io?.brevity ?? 0).toFixed(2),
    punc: f.io?.punctuation,
    meme: Number(f.io?.meme?.probability ?? 0).toFixed(2),
    mask: Number(f.display?.mask ?? 0).toFixed(2),
    // 细微状态按拍轮换：要跨几拍看，单拍会漏掉排队中的那几条
    text: Array.from({length:12},(_,k)=>k).map(k => render(f, { hour: 20, tick: k })).join('|'),
  })
}

function runPatch(patch) {
  let t = T0
  const e = createEngine({ now: () => t })
  if (patch) {
    const { id, key, value } = patch
    const mod = e.organs[id]
    const orig = mod.read.bind(mod)
    mod.read = () => {
      const v = orig()
      if (!v || typeof v !== 'object') return v
      return { ...v, [key]: value }
    }
  }
  e.tick([{ type: 'user', text: MSG, at: t }])
  t += 60_000
  e.tick([])
  return signature(e.read())
}

// 传进去的那种：改内部状态，让它自己跑几拍把影响传开
function runState(patch) {
  let t = T0
  const e = createEngine({ now: () => t })
  if (patch) {
    const { id, key, value } = patch
    const mod = e.organs[id]
    const s = mod.snapshot()
    s[key] = value
    mod.restore(s)
  }
  e.tick([{ type: 'user', text: MSG, at: t }])
  for (let i = 0; i < 3; i++) { t += 300_000; e.tick([]) }
  return signature(e.read())
}

const base = runPatch(null)
const baseState = runState(null)
const modules = ['hypothalamus', 'amygdala', 'insula', 'pfc', 'hippocampus', 'neuromod', 'attention', 'social', 'brainstem', 'dmn', 'endocrine', 'sickness', 'curve', 'rhythm', 'bias']
const perModule = {}
const dead = []

for (const id of modules) {
  const probe = createEngine({ now: () => T0 })
  const mod = probe.organs[id]
  if (!mod || typeof mod.read !== 'function') continue
  const r0 = mod.read()
  if (!r0 || typeof r0 !== 'object') continue
  const fields = Object.keys(r0).filter(k => k !== 'frame' && (typeof r0[k] === 'number' || typeof r0[k] === 'boolean'))
  perModule[id] = { total: fields.length, live: 0, dead: [] }
  for (const key of fields) {
    const cur = r0[key]
    // 数值就试两个极端：只试一个会撞上"本来就是这个值"，造成假死
    const alts = typeof cur === 'boolean' ? [!cur] : [0, 1].filter(v => v !== cur)
    let moved = false
    for (const alt of alts) {
      const outPatch = runPatch({ id, key, value: alt })
      const outState = runState({ id, key, value: alt })
      if (outPatch !== base || outState !== baseState) { moved = true; break }
    }
    if (moved) perModule[id].live += 1
    else { perModule[id].dead.push(key); dead.push(`${id}.${key}`) }
  }
}

let total = 0
let liveTotal = 0
console.log('模块              有传导/可测    没传到输出的')
for (const [id, r] of Object.entries(perModule)) {
  total += r.total
  liveTotal += r.live
  const pct = r.total ? (r.live / r.total * 100).toFixed(0) : '-'
  console.log(`${id.padEnd(14)} ${String(r.live).padStart(2)}/${String(r.total).padEnd(3)} ${pct.padStart(3)}%   ${r.dead.slice(0, 6).join(',')}${r.dead.length > 6 ? ' …' : ''}`)
}
console.log(`\n合计有传导 ${liveTotal}/${total} = ${(liveTotal / total * 100).toFixed(1)}%`)
console.log(`完全没传导（${dead.length}）：${dead.join(' ')}`)
process.exit(0)




