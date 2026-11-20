// H02 仪式感：到点才做，一天一次；没到点、已做过都不说
import { createRitual } from '../core/ritual.js'

const fails = []
const ok = (c, m, d = '') => { if (!c) { fails.push(m + ' — ' + d); console.log('FAIL ' + m + (d ? ' — ' + d : '')) } }

// 用本地时间构造，避免时区把断言带偏
const at = (h, m = 0, day = 19) => new Date(2026, 10, day, h, m, 0).getTime()

const r = createRitual()

// 下午三点：不在任何仪式窗口
const none = r.check(at(15, 0))
ok(none.line === null && none.because === 'not-yet', '没到点不该说', JSON.stringify(none))

// 中午 12 点：饭点仪式
const lunch = r.check(at(12, 0))
ok(lunch.key === 'lunch' && /饭点/.test(String(lunch.line)), '到饭点该说', JSON.stringify(lunch))

// 同一天再说一次：不重复
const again = r.check(at(12, 30))
ok(again.line === null && again.because === 'already-done', '同一天不该重复说', JSON.stringify(again))

// 第二天中午：又能说了
const nextDay = r.check(at(12, 10, 20))
ok(nextDay.line !== null, '第二天该能再说', JSON.stringify(nextDay))

// 晚上 22:40：晚安仪式
const night = r.check(at(22, 40))
ok(night.key === 'goodnight' && /晚安/.test(String(night.line)), '22:40 该说晚安', JSON.stringify(night))

// 23:59 还在窗口内，但今天已经说过 → 不再说
const late = r.check(at(23, 59))
ok(late.because === 'already-done', '晚安一天一次', JSON.stringify(late))

// 早上 7 点：早安仪式
const morning = createRitual()
const am = morning.check(at(8, 0))
ok(am.key === 'morning' && /早上好/.test(String(am.line)), '早上该道早安', JSON.stringify(am))

// 22:29 还没到晚安的点
const early = createRitual()
ok(early.check(at(22, 29)).line === null, '差一分钟不该提前说', '')

// 存档
const snap = r.snapshot()
const r2 = createRitual()
r2.restore(snap)
// 存档里 lunch 记的是第二天（20 号），所以要用第二天来验
ok(r2.check(at(12, 20, 20)).because === 'already-done', '存档读回来丢了"今天已说过"', JSON.stringify(r2.snapshot()))

// 脏数据
const junk = createRitual({ done: 'x' })
ok(junk.check(at(15, 0)).line === null, '脏数据不该乱说', '')

if (fails.length) process.exit(1)
console.log('PASS 仪式感（没到点不说 / 到点说一次 / 同日不重复 / 隔天再说 / 晚安一天一次 / 差一分钟不提前 / 存档 / 脏数据）')
