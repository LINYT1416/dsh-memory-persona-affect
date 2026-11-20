// 巩固优先级：重要的先重放，且顺序按时间讲事。
import { consolidationScore, orderForConsolidation, corroborate, recencyScore, entityHeat } from '../organs/hippocampus/lib/priority.js'

let fail = 0
const ok = (c, m) => { if (!c) { fail++; console.log('FAIL', m) } }
const DAY = 24 * 60 * 60 * 1000
const now = 1_700_000_000_000

const mk = (id, start, salience, entities = [], confidence = 0.6) => ({ id, start, salience, entities, confidence, state: 'closed' })

// 老的但重要 vs 新的但不重要：重要的要先被挑中
const importantOld = mk('imp', now - 10 * DAY, 0.95, ['加班'])
const trivialNew = mk('triv', now - 60 * 1000, 0.1, ['天气'])
const picked = orderForConsolidation([importantOld, trivialNew], { now, limit: 1, allEpisodes: [importantOld, trivialNew] })
ok(picked.length === 1 && picked[0].id === 'imp', `应优先挑重要的那条，实际 ${picked.map((p) => p.id)}`)

// 同样条件时按时间讲事
const a = mk('a', now - 2 * DAY, 0.8, ['x'])
const b = mk('b', now - 1 * DAY, 0.8, ['x'])
const two = orderForConsolidation([b, a], { now, limit: 2, allEpisodes: [a, b] })
ok(two[0].id === 'a' && two[1].id === 'b', `选中后应按时间正序，实际 ${two.map((p) => p.id)}`)

// 分数分解必须自洽
const s = consolidationScore(a, { now, allEpisodes: [a, b] })
const sum = s.parts.salience * 0.5 + s.parts.recency * 0.2 + s.parts.heat * 0.2 + s.parts.confidence * 0.1
ok(Math.abs(s.score - sum) < 0.002, `score(${s.score}) 应等于加权和(${sum.toFixed(4)})`)
ok(s.score > 0 && s.score <= 1, `score 应在 (0,1]，实际 ${s.score}`)

// 新近度单调
ok(recencyScore(now, now) > recencyScore(now - DAY, now), '越新新近度越高')

// 实体热度：同样的词出现越多越热
ok(entityHeat(['x'], [a, b], now) > entityHeat(['zzz'], [a, b], now), '热门实体热度应更高')

// 互证：同实体涨分，不相关的和自身都不算
const ep = mk('new', now, 0.6, ['加班', '老板'])
const priorSame = mk('p1', now - DAY, 0.5, ['加班'], 0.7)
const priorOther = mk('p2', now - DAY, 0.5, ['天气'], 0.7)
const self = mk('new', now, 0.6, ['加班'], 0.6)
const corr = corroborate(ep, [priorSame, priorOther, self])
ok(corr.matched.length === 1 && corr.matched[0].id === 'p1', `只应互证同实体那条，实际 ${JSON.stringify(corr.matched.map((m) => m.id))}`)
ok(Math.abs(corr.matched[0].after - 0.73) < 1e-9, `涨幅应为 +0.03，实际 ${corr.matched[0].after}`)

// 封顶
const hot = mk('p3', now - DAY, 0.5, ['加班'], 0.94)
const capped = corroborate(ep, [hot])
ok(capped.matched[0].after <= 0.95, `置信度封顶 0.95，实际 ${capped.matched[0].after}`)


// 幂等：同一批反复跑，不能把置信度一路顶到天花板
const rep1 = corroborate(ep, [priorSame])
const rep2 = corroborate(ep, [{ ...priorSame, corroboratedBy: ['new'], confidence: rep1.matched[0].after }])
ok(Math.abs(rep1.matched[0].after - rep2.matched[0].after) < 1e-9, `重复互证应稳定：${rep1.matched[0].after} vs ${rep2.matched[0].after}`)

// 三次不同印证者：0.70 + 0.03*3 = 0.79，逐次可解释
const p4 = mk('p4', now - DAY, 0.5, ['加班'], 0.70)
const r1 = corroborate(ep, [p4])
const r3 = corroborate(ep, [{ ...p4, corroboratedBy: ['a', 'b'] }])
ok(Math.abs(r1.matched[0].after - 0.73) < 1e-9, `1 个印证 → 0.73，实际 ${r1.matched[0].after}`)
ok(Math.abs(r3.matched[0].after - 0.79) < 1e-9, `3 个印证 → 0.79，实际 ${r3.matched[0].after}`)
console.log(fail ? `FAIL ${fail}` : `PASS 巩固优先级（重要先跑 + 时间讲事 + 互证涨分 + 封顶）`)
process.exit(fail ? 1 : 0)
