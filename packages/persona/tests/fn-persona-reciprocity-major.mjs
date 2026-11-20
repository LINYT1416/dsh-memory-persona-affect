// R05 互惠账本 + D06 重大事件
import { createReciprocity } from '../core/reciprocity.js'
import { createMajorEvent } from '../core/major-event.js'

const fails = []
const ok = (c, m, d = '') => { if (!c) { fails.push(m + ' — ' + d); console.log('FAIL ' + m + (d ? ' — ' + d : '')) } }
const DAY = 86400000

// ── R05 互惠 ──
const r = createReciprocity()
ok(r.line() === null, '一开始不欠什么，不该说', String(r.line()))
r.receive('帮我看了报错')
ok(r.line() === '上次那事我还没谢你', '欠一次该提', String(r.line()))
r.receive('给我带了饭')
ok(/还你个人情/.test(String(r.line())), '欠两次该说还人情', String(r.line()))
r.repay('请他喝奶茶')
ok(/还没谢你/.test(String(r.line())), '还了一次但还欠一次，应该还提', String(r.line()))
r.repay('又请他吃饭')
ok(/两清/.test(String(r.line())), '还清该说两清', String(r.line()))
ok(r.snapshot().owed === 0, '还多了不该变负数', JSON.stringify(r.snapshot()))

// 记录里能看到来龙去脉
const snap = r.snapshot()
ok(Array.isArray(snap.entries) && snap.entries.length > 0, '账本里该有记录', JSON.stringify(snap))
const r2 = createReciprocity()
r2.restore(snap)
ok(r2.snapshot().owed === 0, '存档读回来对不上', JSON.stringify(r2.snapshot()))

// ── D06 重大事件 ──
const m = createMajorEvent()
ok(m.hit(0.3, '被说了一句').major === false, '小事不算重大', '')
ok(m.hit(0.85, '被说养不起').major === true, '够大才算', '')
ok(/记着/.test(String(m.line())), '该留一句', String(m.line()))

// 时间会冲淡
const old = createMajorEvent()
old.hit(0.9, '旧事', Date.now() - 40 * DAY)
ok(old.line() === null, '过了 30 天不该再提', String(old.line()))

// 两天之内的还记着
const near = createMajorEvent()
near.hit(0.9, '新事', Date.now() - 2 * DAY)
ok(near.line() !== null, '两天内该记着', String(near.line()))

// 脏数据
ok(createMajorEvent().hit(NaN, 'x').major === false, '脏数据不算', '')
ok(createMajorEvent().hit('0.8', '字符串').major === true, '数字字符串该认', '')

if (fails.length) process.exit(1)
console.log('PASS 互惠+重大事件（欠一次提示/欠两次还人情/还清两清/不欠不计；小事不算/大事记着/30天淡出/脏数据）')
