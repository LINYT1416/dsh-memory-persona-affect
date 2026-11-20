// X10 道歉方式 + R08 冲突与和解
import { decideRepair, createRepairState } from '../core/repair.js'

const fails = []
const ok = (c, m, d = '') => { if (!c) { fails.push(m + ' — ' + d); console.log('FAIL ' + m + (d ? ' — ' + d : '')) } }
const t0 = 1_800_000_000_000

// 被怼 → 道歉，且只一句
const hurtReads = { tpj: { offense: 0.8 } }
const s1 = createRepairState()
const r1 = s1.decide(hurtReads, {}, t0)
ok(r1.action === 'apologize', '被怼时该道歉', JSON.stringify(r1))
ok(r1.line && r1.line.length <= 12, '道歉应该短', String(r1.line))

// 半小时内再被怼：不重复道歉（人设：别反复）
const r2 = s1.decide(hurtReads, {}, t0 + 5 * 60 * 1000)
ok(r2.action !== 'apologize', '半小时内不该再道歉', JSON.stringify(r2))

// 对方软下来 → 翻篇
const r3 = s1.decide({ ofc: { warm: 0.8 } }, {}, t0 + 10 * 60 * 1000)
ok(r3.action === 'repair', '对方软下来该翻篇', JSON.stringify(r3))
ok(/翻篇/.test(String(r3.line)), '翻篇措辞不对', String(r3.line))

// 翻篇之后：不再提
const r4 = s1.decide({}, {}, t0 + 20 * 60 * 1000)
ok(r4.action === null && r4.line === null, '翻篇后不该再提', JSON.stringify(r4))

// 过了冷却、又出事：可以再道一次
const s2 = createRepairState()
s2.decide(hurtReads, {}, t0)
const r5 = s2.decide(hurtReads, {}, t0 + 40 * 60 * 1000)
ok(r5.action === 'apologize', '过了半小时可以再道一次', JSON.stringify(r5))

// 陈年旧伤：不当场翻旧账
const old = decideRepair(hurtReads, { lastHurtAt: t0 - 2 * 60 * 60 * 1000 }, {}, t0)
ok(old.action === 'hold', '旧伤不该当场翻', JSON.stringify(old))

// 存档
const snap = s1.snapshot()
const s3 = createRepairState()
s3.restore(snap)
ok(s3.snapshot().pendingRepair === false, '存档读到 pendingRepair 不对', JSON.stringify(s3.snapshot()))

if (fails.length) process.exit(1)
console.log('PASS 道歉与和解（被怼→一句道歉；半小时不重复；软下来→翻篇；旧伤不翻；存档可回）')
