// S02 自尊完整版：会累积、会回落；骂比夸更管用；不会一直塌也不会一直飘
import { createWorth } from '../core/worth.js'

const fails = []
const ok = (c, m, d = '') => { if (!c) { fails.push(m + ' — ' + d); console.log('FAIL ' + m + (d ? ' — ' + d : '')) } }
const t0 = 1_800_000_000_000
const HOUR = 60 * 60 * 1000

const w = createWorth({ at: t0 })
ok(w.value(t0) === 0.5, '初始该是基线 0.5', String(w.value(t0)))

// 被夸：上去
w.hit('praise', t0)
ok(w.value(t0) > 0.5, '被夸该上去', String(w.value(t0)))

// 被否定：下来，而且幅度比夸大（负性偏差）
const w2 = createWorth({ at: t0 })
w2.hit('criticism', t0)
const drop = 0.5 - w2.value(t0)
const rise = w.value(t0) - 0.5
ok(drop > rise, '骂应该比夸更管用', 'drop=' + drop.toFixed(3) + ' rise=' + rise.toFixed(3))

// 时间冲淡：24 小时后往中间回
const w3 = createWorth({ at: t0, value: 0.2 })
const before = w3.value(t0)
const after = w3.value(t0 + 24 * HOUR)
ok(after > before, '24 小时后该往回走', before + ' → ' + after)
ok(after < 0.5, '不该一下弹回基线', String(after))

// 一直骂也不归零
const w4 = createWorth({ at: t0 })
for (let i = 0; i < 50; i++) w4.hit('criticism', t0)
ok(w4.value(t0) >= 0.05, '骂到底也有下限', String(w4.value(t0)))

// 一直夸也不封顶
const w5 = createWorth({ at: t0 })
for (let i = 0; i < 50; i++) w5.hit('praise', t0)
ok(w5.value(t0) <= 0.95, '夸到顶也有上限', String(w5.value(t0)))

// 存档
const snap = w.snapshot()
const w6 = createWorth()
w6.restore(snap)
ok(Math.abs(w6.value(t0) - snap.value) < 0.05, '存档读回来不一致', JSON.stringify(w6.snapshot()))

// 脏数据
const w7 = createWorth({ value: 'x', at: NaN })
ok(Number.isFinite(w7.value(t0)), '脏数据该给数', String(w7.value(t0)))

if (fails.length) process.exit(1)
console.log('PASS 自尊完整版（初始基线/夸上去/骂更管用/24h回落/有上下限/存档/脏数据）')
