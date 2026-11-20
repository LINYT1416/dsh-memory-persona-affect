// 关系账本：帮忙/道谢/道歉/伤人 只记硬词，账面到阈值才说一句话
import { createRelation } from '../core/relation.js'

const fails = []
const ok = (c, m, d = '') => { if (!c) { fails.push(m + ' — ' + d); console.log('FAIL ' + m + (d ? ' — ' + d : '')) } }

const r = createRelation()
ok(r.snapshot().debt === 0, '初始不该有账', JSON.stringify(r.snapshot()))
ok(r.line() === null, '没到阈值不该说话', String(r.line()))

r.note('谢谢你帮我改那个脚本')
r.note('麻烦你了')
r.note('谢谢你')
const after = r.snapshot()
ok(after.debt === 3, '三次帮忙应该记 3 次账', JSON.stringify(after))
const line = r.line()
ok(typeof line === 'string' && line.includes('3'), '账面到 3 该念出来', String(line))

const r2 = createRelation()
r2.note('我帮你弄吧')
r2.note('我帮你弄吧')
r2.note('我帮你弄吧')
ok(r2.snapshot().debt === -3, '我帮三次应该是负账', JSON.stringify(r2.snapshot()))
ok(String(r2.line()).includes('欠我'), '负账措辞不对', String(r2.line()))

const r3 = createRelation()
const before = r3.snapshot().intimacy
r3.note('你是真的很烦')
r3.note('闭嘴吧')
r3.note('别说了')
const after3 = r3.snapshot()
ok(after3.hurts === 3, '伤人的话没记上', JSON.stringify(after3))
ok(after3.intimacy < before + 0.05, '被伤到应该掉亲密，实际 ' + before + ' → ' + after3.intimacy)
ok(String(r3.line() || '').includes('重'), '伤了三次该说一句', String(r3.line()))

const r4 = createRelation({ debt: 5, intimacy: 0.8 })
const snap = r4.snapshot()
const r5 = createRelation()
r5.restore(snap)
ok(r5.snapshot().debt === 5 && r5.snapshot().intimacy === 0.8, '存档读回来不对', JSON.stringify(r5.snapshot()))

if (fails.length) process.exit(1)
console.log('PASS 关系账本（人情 ±3 才念、道歉也记账、伤人会掉亲密、存档可回）')
