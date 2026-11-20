// S05 自我效能：我做不做得到（依据是"答应过的事成了几次"）
import { efficacyOf } from '../core/efficacy.js'

const fails = []
const ok = (c, m, d = '') => { if (!c) { fails.push(m + ' — ' + d); console.log('FAIL ' + m + (d ? ' — ' + d : '')) } }

// 样本太少：不下结论
const few = efficacyOf({ done: 1, failed: 1 })
ok(few.line === null, '样本少时不该下判断', JSON.stringify(few))
ok(few.efficacy > 0.4 && few.efficacy < 0.7, '样本少时应接近中性', JSON.stringify(few))

// 连续做成：有把握
const good = efficacyOf({ done: 8, failed: 1 })
ok(/有把握/.test(String(good.line)), '做成率高该说有把握', JSON.stringify(good))

// 连续黄：先别答应
const bad = efficacyOf({ done: 1, failed: 7 })
ok(/搞不定/.test(String(bad.line)), '做成率低该说先别答应', JSON.stringify(bad))

// 中等：不表态
const mid = efficacyOf({ done: 4, failed: 3 })
ok(mid.line === null, '中等不该表态', JSON.stringify(mid))

// 脏数据
const junk = efficacyOf({ done: 'x', failed: NaN })
ok(Number.isFinite(junk.efficacy) && junk.efficacy >= 0 && junk.efficacy <= 1, '脏数据也该给 0~1', JSON.stringify(junk))

// 单调性：成的越多，效能越高
const a = efficacyOf({ done: 2, failed: 6 }).efficacy
const b = efficacyOf({ done: 6, failed: 2 }).efficacy
ok(b > a, '成的越多效能应更高', a + ' vs ' + b)

if (fails.length) process.exit(1)
console.log('PASS 自我效能（样本少不下结论 / 高→有把握 / 低→先别答应 / 中间不表态 / 脏数据不炸 / 单调）')
