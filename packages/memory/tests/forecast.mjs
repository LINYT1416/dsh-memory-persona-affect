// 未来推演：只推两种有依据的，不编。
import { pendingPlans, routinePatterns, forecast, forecastLine } from '../organs/hippocampus/lib/forecast.js'

let fail = 0
const ok = (c, m) => { if (!c) { fail++; console.log('FAIL', m) } }
const now = 1_700_000_000_000
const H = 3600 * 1000
const mk = (id, start, text, type = 'event') => ({ id, start, summary: text, type })

// 1) 未兑现的计划
const plan = mk('p1', now - 2 * H, '明天要去医院复查')
ok(pendingPlans([plan], { now }).length === 1, '说过要做的计划应被推出来')

// 2) 已经做完的不算
const done = mk('p2', now - 2 * H, '明天要去医院复查，已经做完了')
ok(pendingPlans([done], { now }).length === 0, '做完的不该再推')

// 3) 后来做了的不算
const later = { ...mk('p3', now - 1 * H, '明天要去医院复查'), entities: ['医院'] }
const doneLater = { ...mk('p4', now - 0.5 * H, '复查搞定了'), entities: ['医院'] }
ok(pendingPlans([later, doneLater], { now }).length === 0, '后续有完成信号就不推')

// 4) 太久远的不推
const old = mk('p5', now - 10 * 24 * H, '明天要去医院复查')
ok(pendingPlans([old], { now }).length === 0, '超过回溯窗口不推')

// 5) 时段习惯：同一 3 小时窗口出现 3 次
const base = new Date(now).setHours(20, 0, 0, 0)
const routine = [0, 1, 2].map((i) => mk('r' + i, base - i * 24 * H, '在公司加班', 'event'))
const items = routinePatterns(routine, { now, windowDays: 7, minCount: 3 })
ok(items.length === 1, `应推出 1 条时段习惯，实际 ${items.length}`)
ok(/18 点到 21 点/.test(items[0].text), `文案应含 18 点到 21 点（20 点落在这个桶），实际 ${items[0].text}`)
ok(items[0].basis.length >= 2, '必须带依据')

// 6) 次数不够不推
ok(routinePatterns(routine.slice(0, 2), { now }).length === 0, '次数不足不推')

// 7) 空输入不炸
ok(forecast([], { now }).length === 0, '空输入应返回空')
ok(forecastLine([]) === '', '空列表不出话')

// 8) 有依据才说得出口
ok(forecastLine(forecast([plan], { now })).includes('可能接着'), '有推演时应给出一句话')

console.log(fail ? `FAIL ${fail}` : `PASS 未来推演（未兑现计划/完成信号排除/时间窗/时段习惯/依据必需/空输入）`)
process.exit(fail ? 1 : 0)
