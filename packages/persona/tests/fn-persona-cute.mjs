// X11 撒娇与示弱：不熟不许撒，被怼时不许撒，三小时只撒一次
import { createCuteState, decideCute } from '../core/cute.js'

const fails = []
const ok = (c, m, d = '') => { if (!c) { fails.push(m + ' — ' + d); console.log('FAIL ' + m + (d ? ' — ' + d : '')) } }
const t0 = 1_800_000_000_000

// 不熟：不许撒娇
const cold = decideCute({ intimacy: 0.3 }, { ofc: { warm: 0.9 } }, {}, t0)
ok(cold.cute === false && cold.why === 'not-close', '不熟不该撒娇', JSON.stringify(cold))

// 很熟 + 对方暖：可以
const warm = decideCute({ intimacy: 0.8 }, { ofc: { warm: 0.8 } }, {}, t0)
ok(warm.cute === true && /多陪我/.test(String(warm.line)), '很熟且暖时该能撒娇', JSON.stringify(warm))

// 很熟但对方在火头上：不许
const angry = decideCute({ intimacy: 0.8 }, { ofc: { warm: 0.9 }, tpj: { offense: 0.8 } }, {}, t0)
ok(angry.cute === false && angry.why === 'offended', '被怼时不该撒娇', JSON.stringify(angry))

// 很熟但没有由头：不撒
const noCue = decideCute({ intimacy: 0.8 }, {}, {}, t0)
ok(noCue.cute === false && noCue.why === 'no-cue', '没有由头不该撒娇', JSON.stringify(noCue))

// 冷却：三小时内只一次
const s = createCuteState()
const first = s.decide({ intimacy: 0.9 }, { ofc: { warm: 0.9 } }, t0)
ok(first.cute === true, '第一次应该能撒', JSON.stringify(first))
const second = s.decide({ intimacy: 0.9 }, { ofc: { warm: 0.9 } }, t0 + 60 * 60 * 1000)
ok(second.cute === false && second.why === 'cooldown', '一小时后不该再撒', JSON.stringify(second))
const third = s.decide({ intimacy: 0.9 }, { ofc: { warm: 0.9 } }, t0 + 4 * 60 * 60 * 1000)
ok(third.cute === true, '过了三小时可以再撒', JSON.stringify(third))

// 存档
const snap = s.snapshot()
const s2 = createCuteState()
s2.restore(snap)
ok(s2.snapshot().lastCuteAt === snap.lastCuteAt, '存档读回来不一致', JSON.stringify(s2.snapshot()))

if (fails.length) process.exit(1)
console.log('PASS 撒娇与示弱（不熟不许 / 被怼不许 / 无由头不撒 / 三小时一次 / 存档可回）')
