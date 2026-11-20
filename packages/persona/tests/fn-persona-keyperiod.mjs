// D03 创伤与关键期：一周内密集被扎才算，且会随时间淡
import { createKeyPeriod } from '../core/keyperiod.js'

const fails = []
const ok = (c, m, d = '') => { if (!c) { fails.push(m + ' — ' + d); console.log('FAIL ' + m + (d ? ' — ' + d : '')) } }
const DAY = 24 * 60 * 60 * 1000
const t0 = Date.parse('2026-11-01T10:00:00Z')

// 一次不算
const one = createKeyPeriod()
one.note(t0)
ok(one.active(t0) === false, '被扎一次不算关键期', JSON.stringify(one.snapshot()))

// 三天内三次：算
const dense = createKeyPeriod()
dense.note(t0); dense.note(t0 + DAY); dense.note(t0 + 2 * DAY)
ok(dense.active(t0 + 2 * DAY) === true, '一周内三次该算关键期', JSON.stringify(dense.snapshot()))
ok(/还没完全过去/.test(String(dense.line(t0 + 2 * DAY))), '关键期该说一句', String(dense.line(t0 + 2 * DAY)))

// 三十天后：淡掉
ok(dense.active(t0 + 2 * DAY + 31 * DAY) === false, '一个月后该淡掉', JSON.stringify(dense.snapshot()))

// 拉得很开（每周一次，跨一个月）：窗口内不够三次，不算
const sparse = createKeyPeriod()
for (let i = 0; i < 4; i++) sparse.note(t0 + i * 8 * DAY)
ok(sparse.active(t0 + 24 * DAY) === false, '拉得太开不该算关键期', JSON.stringify(sparse.snapshot()))

// 只标一次：不会重复标记
const once = createKeyPeriod()
once.note(t0); once.note(t0 + 1); once.note(t0 + 2)
const mark1 = once.snapshot().markedAt
once.note(t0 + 3)
ok(once.snapshot().markedAt === mark1, '关键期不该反复重标', String(once.snapshot().markedAt))

// 存档
const snap = dense.snapshot()
const d2 = createKeyPeriod()
d2.restore(snap)
ok(d2.active(t0 + 2 * DAY) === true, '存档读回来丢了关键期', JSON.stringify(d2.snapshot()))

// 脏数据
const junk = createKeyPeriod({ hits: ['x', null, 1], markedAt: 'y' })
ok(junk.active(t0) === false, '脏数据不该激活', JSON.stringify(junk.snapshot()))

if (fails.length) process.exit(1)
console.log('PASS 创伤与关键期（一次不算 / 一周三次才算 / 一个月后淡掉 / 拉太开不算 / 不重复标 / 存档 / 脏数据）')
