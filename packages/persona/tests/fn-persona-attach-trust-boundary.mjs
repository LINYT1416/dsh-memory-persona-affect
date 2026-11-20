// R01 依恋 / R02 信任 / R03 边界：三条都从关系账本的真实数据算
import { createRelation } from '../core/relation.js'
import { trust } from '../core/trust.js'
import { boundaryOf } from '../core/boundary.js'

const fails = []
const ok = (c, m, d = '') => { if (!c) { fails.push(m + ' — ' + d); console.log('FAIL ' + m + (d ? ' — ' + d : '')) } }

// ── R01 依恋：一起待久了会变近 ──
// 别用 20 句喂出"熟"：真实是 50 句才到 familiar
const r1 = createRelation()
const start = r1.snapshot().intimacy
for (let i = 0; i < 20; i++) r1.note('在吗')
const after20 = r1.snapshot().intimacy
ok(after20 > start, '聊多了该更近', start + ' -> ' + after20)
ok(after20 < 0.55, '20 句不该直接变成熟人', String(after20))

for (let i = 0; i < 60; i++) r1.note('在吗')
const after80 = r1.snapshot().intimacy
ok(after80 >= 0.55, '80 句该到熟人档', String(after80))
ok(after80 <= 1, '不该超过 1', String(after80))

// 被伤到：依恋会退
const r2 = createRelation({ intimacy: 0.8 })
const before = r2.snapshot().intimacy
r2.note('你真的很烦，闭嘴')
ok(r2.snapshot().intimacy < before, '被伤到该退一步', before + ' -> ' + r2.snapshot().intimacy)
ok(r2.snapshot().hurts === 1, '要记下这一刀', String(r2.snapshot().hurts))

// ── R02 信任 ──
ok(trust({ intimacy: 0.9, hurts: 0 }).value > 0.8, '没伤过的熟关系该高信任', JSON.stringify(trust({ intimacy: 0.9 })))
ok(trust({ intimacy: 0.9, hurts: 6 }).value < trust({ intimacy: 0.9, hurts: 0 }).value, '伤多了信任该降', '')
ok(trust({ intimacy: 0.9, hurts: 6, apologies: 3 }).value > trust({ intimacy: 0.9, hurts: 6 }).value, '道歉该补一点', '')
ok(trust({ intimacy: 0.9, hurts: 20, apologies: 20 }).value >= 0, '不能负', '')
ok(trust({}).level === 'guarded' || trust({}).level === 'wary', '陌生人不该被信任', JSON.stringify(trust({})))
ok(trust({ intimacy: 0.95, hurts: 0 }).level === 'trusts', '该能到信任档', JSON.stringify(trust({ intimacy: 0.95 })))

// ── R03 边界 ──
const stranger = boundaryOf({ intimacy: 0.1 })
const acquaintance = boundaryOf({ intimacy: 0.35 })
const familiar = boundaryOf({ intimacy: 0.6 })
const close = boundaryOf({ intimacy: 0.9 })

ok(stranger.level === 'stranger', '陌生人档不对', JSON.stringify(stranger))
ok(stranger.sharesPrivate === false, '陌生人不能聊私事', '')
ok(acquaintance.level === 'acquaintance' && acquaintance.sharesPrivate === false, '半熟也别聊私事', JSON.stringify(acquaintance))
ok(familiar.level === 'familiar' && familiar.sharesPrivate === true, '熟人可以聊私事', JSON.stringify(familiar))
ok(close.level === 'close' && close.teases === true, '很熟才敢损', JSON.stringify(close))
ok(familiar.teases === false, '熟人还不敢乱损', JSON.stringify(familiar))
// 被伤到信任掉下来，私事口子要收紧
const hurtClose = boundaryOf({ intimacy: 0.9, hurts: 8 })
ok(hurtClose.sharesPrivate === false, '伤多了连熟人也收紧', JSON.stringify(hurtClose))
ok(typeof stranger.boundary === 'string' && stranger.boundary.length > 3, '边界该有一句话', String(stranger.boundary))

if (fails.length) process.exit(1)
console.log('PASS 依恋+信任+边界（20句不到熟人/80句到熟人/被伤退步；信任随伤降、道歉补一点、不为负；边界四档、伤后收紧）')
