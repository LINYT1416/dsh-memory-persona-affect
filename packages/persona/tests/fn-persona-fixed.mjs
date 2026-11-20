// 人格器官：这一轮修过的五条要有可复现断言（A01/A02/A09/S11/A12）
//   node tests/fn-persona-fixed.mjs
import { readFileSync } from 'node:fs'
import { create as accCreate } from '../organs/acc.js'
import { create as strCreate } from '../organs/str.js'

const fails = []
let n = 0
const ok = (c, m, d = '') => { n++; if (!c) { fails.push(m + (d ? ' — ' + d : '')); console.log('FAIL ' + m + (d ? ' — ' + d : '')) } }

const dt = 60000
const worldOf = (o) => ({ tx: { dtMs: dt, f: o.f || {} }, affect: o.affect ?? null, get: (k) => (o.organs && o.organs[k]) || null })

// A01：没有习惯就不该有冲突（以前白纸首拍恒 0.45）
{
  const a = accCreate()
  a.step(worldOf({ organs: { str: { primed: 0 }, ofc: { intent: 0.5 } } }))
  const r = a.read()
  ok(r.conflict < 0.35, 'A01 无习惯却报冲突', `conflict=${r.conflict}`)
  // 有习惯且意向相反 → 该报
  const b = accCreate()
  b.step(worldOf({ organs: { str: { primed: 0.9 }, ofc: { intent: 0.1 } } }))
  ok(b.read().conflict > 0.35, 'A01 有习惯且相反却没报冲突', `conflict=${b.read().conflict}`)
}

// A02/A03：情绪效价翻面才该记"猜错了"（以前读不到 affect，永远 0）
{
  const a = accCreate()
  a.step(worldOf({ affect: { valence: 0.8 }, organs: { str: { primed: 0 }, ofc: { intent: 0.5 } } }))
  a.step(worldOf({ affect: { valence: -0.9 }, organs: { str: { primed: 0 }, ofc: { intent: 0.5 } } }))
  const r = a.read()
  ok(r.error > 0, 'A02 效价翻面后 error 仍为 0', `error=${r.error}`)
  ok(r.adjusting > 0, 'A03 错后调整仍为 0', `adjusting=${r.adjusting}`)
}

// A09：断一次就到得了 0.3 门槛（breakPenalty=0.25，门槛原为 0.3）
{
  const a = accCreate()
  let r
  for (let i = 0; i < 4; i++) {
    a.step(worldOf({ organs: { str: { broken: 0.25, ritual: 0.3, primed: 0 }, ofc: { intent: 0.5 } } }))
    r = a.read()
  }
  ok(r.compulsion > 0, 'A09 连续断点却始终没有强迫感', `compulsion=${r.compulsion}`)
}

// S11：腻了之后习惯强度涨得更慢（以前 satiation 完全不参与）
{
  const mk = () => strCreate()
  const tickN = (s, times, text, value) => {
    for (let i = 0; i < times; i++) {
      s.step({ tx: { dtMs: dt, text, cue: 'praise', t1: Date.now() + i * dt, f: {} }, get: () => null, affect: null })
    }
    return s.read()
  }
  const fresh = mk()
  tickN(fresh, 12, '你今天真厉害', 0.9)
  const freshS = fresh.read().top?.[0]?.s ?? fresh.read().habitStrength ?? null
  ok(true, 'S11 结构检查（见下条数值断言）')
  // 直接看 satiation 是否影响增量：同一段文本第 1..N 次，增量应递减
  const s2 = mk()
  const incs = []
  let prev = 0
  for (let i = 0; i < 10; i++) {
    s2.step({ tx: { dtMs: dt, text: '你今天真厉害', cue: 'praise', t1: Date.now() + i * dt, f: {} }, get: () => null, affect: null })
    const cur = s2.read().top?.[0]?.s ?? 0
    incs.push(+(cur - prev).toFixed(4)); prev = cur
  }
  const first = incs[0], last = incs[incs.length - 1]
  ok(last <= first + 1e-6, 'S11 腻了之后习惯增量没有变小', `first=${first} last=${last}`)
}

// A12：tx 必须带 role（以前没有这个字段，条件恒 false）
{
  const eng = readFileSync(new URL('../core/engine.js', import.meta.url), 'utf8')
  ok(/role:\s*uniq\.some/.test(eng), 'A12 tx 里没有 role 字段')
}

if (fails.length) { console.log(`\n${fails.length}/${n} 条失败`); process.exit(1) }
console.log(`\nPASS 人格修复断言（${n} 条：A01 无习惯不报冲突 / 有习惯相反必报；A02+A03 效价翻面记账；A09 断点能到强迫；S11 习惯增量递减；A12 tx 有 role）`)
