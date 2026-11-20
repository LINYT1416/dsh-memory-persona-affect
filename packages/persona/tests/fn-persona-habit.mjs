// H01 行为固化：跨天重复才算习惯；一口气做三次不算；断了会退化
import { createHabit } from '../core/habit.js'

const fails = []
const ok = (c, m, d = '') => { if (!c) { fails.push(m + ' — ' + d); console.log('FAIL ' + m + (d ? ' — ' + d : '')) } }
const DAY = 24 * 60 * 60 * 1000
const t0 = Date.parse('2026-11-01T08:00:00Z')

// 一次：不是习惯
const h = createHabit()
h.note('睡前刷手机', t0)
ok(h.isHabit('睡前刷手机', t0) === false, '一次不该是习惯', '')
ok(h.line('睡前刷手机', t0) === null, '一次不该说出去', String(h.line('睡前刷手机', t0)))

// 同一天猛做三次：也不是习惯（一口气做不等于养成了）
const burst = createHabit()
burst.note('喝咖啡', t0)
burst.note('喝咖啡', t0 + 60 * 1000)
burst.note('喝咖啡', t0 + 120 * 1000)
ok(burst.isHabit('喝咖啡', t0 + 180 * 1000) === false, '同一天三次不算习惯', JSON.stringify(burst.snapshot()))

// 跨三天：成了
const good = createHabit()
good.note('喝咖啡', t0)
good.note('喝咖啡', t0 + DAY)
good.note('喝咖啡', t0 + 2 * DAY)
ok(good.isHabit('喝咖啡', t0 + 2 * DAY + 1000) === true, '跨三天该算习惯', JSON.stringify(good.snapshot()))
ok(/不用想/.test(String(good.line('喝咖啡', t0 + 2 * DAY + 1000))), '习惯该说"手先动了"', String(good.line('喝咖啡', t0 + 2 * DAY + 1000)))

// 断了七天：退化
ok(good.isHabit('喝咖啡', t0 + 10 * DAY) === false, '断了七天该退化', JSON.stringify(good.snapshot()))

// 不同的事不混算
const mix = createHabit()
mix.note('喝咖啡', t0); mix.note('跑步', t0 + DAY); mix.note('刷手机', t0 + 2 * DAY)
ok(mix.isHabit('喝咖啡', t0 + 2 * DAY) === false, '不同的事不该混算', JSON.stringify(mix.snapshot()))

// 空 cue 不崩
const empty = createHabit()
ok(empty.note('', t0).habit === false, '空 cue 不该算', JSON.stringify(empty.note('', t0)))

// 存档
const snap = good.snapshot()
const h2 = createHabit()
h2.restore(snap)
ok(h2.isHabit('喝咖啡', t0 + 2 * DAY + 2000) === true, '存档读回来丢了习惯', JSON.stringify(h2.snapshot()))

if (fails.length) process.exit(1)
console.log('PASS 行为固化（一次不算 / 同日猛做不算 / 跨三天才算 / 断七天退化 / 不同事不混算 / 空 cue / 存档）')
