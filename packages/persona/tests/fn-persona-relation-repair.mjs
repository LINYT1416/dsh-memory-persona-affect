// 关系修复：他伤过我、之后道过歉 → 翻篇，不能一直记着
import { createRelation } from '../core/relation.js'

const fails = []
const ok = (c, m, d = '') => { if (!c) { fails.push(m + ' — ' + d); console.log('FAIL ' + m + (d ? ' — ' + d : '')) } }

const t0 = 1_800_000_000_000

// 只被伤、没道歉：不该说翻篇
const a = createRelation()
a.note('你是真的很烦', t0)
ok(!String(a.line() || '').includes('翻篇'), '没道歉就说翻篇了', String(a.line()))

// 伤 → 道歉：该翻篇
const b = createRelation()
b.note('你是真的很烦', t0)
b.note('对不起，刚才我说话难听', t0 + 1000)
ok(String(b.line() || '').includes('翻篇'), '道歉后应该翻篇', String(b.line()))

// 道歉 → 又伤：不能翻篇
const c = createRelation()
c.note('对不起', t0)
c.note('你是真的很烦', t0 + 1000)
ok(!String(c.line() || '').includes('翻篇'), '道歉后又被伤，不该翻篇', String(c.line()))

// 时间戳要落进快照，重启后"翻篇"仍成立
const d = createRelation()
d.note('你是真的很烦', t0)
d.note('对不起', t0 + 1000)
const snap = d.snapshot()
ok(snap.lastHurtAt === t0, 'lastHurtAt 没记', JSON.stringify(snap))
ok(snap.lastApologyAt === t0 + 1000, 'lastApologyAt 没记', JSON.stringify(snap))
const e = createRelation()
e.restore(snap)
ok(String(e.line() || '').includes('翻篇'), '重启后翻篇状态丢了', String(e.line()))

if (fails.length) process.exit(1)
console.log('PASS 关系修复（伤→道歉=翻篇；只伤不翻篇；道歉后又被伤不翻篇；重启后仍翻篇）')
