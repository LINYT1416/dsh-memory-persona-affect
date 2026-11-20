// 抑制规则：错配（时间/类型/主体）、否定、作废、夹具。
// 每条都要有"该砍"和"不该砍"两侧，否则宁可漏。
import { mismatch, negate, isFixture, apply, floor } from '../organs/prefrontal/kernel/inhibit.js'

let fail = 0
const ok = (c, m) => { if (!c) { fail++; console.log('FAIL', m) } else { console.log('  ok:', m) } }
const C = (o) => ({ episodeId: 'e' + Math.random().toString(36).slice(2, 6), summary: '普通一条记忆', score: 1, ...o })

// ── 该砍 ──────────────────────────────────────────────
ok(mismatch(C({ state: 'retracted' }), { filters: {} }) === 'negated', 'retracted 条目要砍（作废不当证据）')
ok(mismatch(C({ retracted: true }), { filters: {} }) === 'negated', 'retracted:true 也要砍')
ok(mismatch(C({ state: 'archived' }), { filters: {} }) === 'archived', 'archived 要砍')
ok(mismatch(C({ at: 1000 }), { filters: { since: 2000 } }) === 'time', '早于 since 的砍')
ok(mismatch(C({ at: 5000 }), { filters: { until: 4000 } }) === 'time', '晚于 until 的砍')
ok(mismatch(C({ type: 'food' }), { filters: { type: 'work' } }) === 'type', '类型不符的砍')
ok(mismatch(C({ entities: ['朋友'] }), { filters: { subject: '主人' } }) === 'entity', '主体不符的砍')
ok(negate(C({ summary: '主人不喜欢下雨' }), '主人喜欢下雨吗') === 'negated', '候选否定 query 在问的事 → 砍')
ok(isFixture(C({ summary: '测试：临时数据（可删）' })) === true, '夹具要识别')

// ── 不该砍（负样本，关键） ──────────────────────────────
ok(mismatch(C({ state: 'consolidated' }), { filters: {} }) === null, '正常条目不许砍')
ok(mismatch(C({ at: 3000 }), { filters: { since: 2000, until: 4000 } }) === null, '落在时间窗内的不许砍')
ok(mismatch(C({ entities: ['主人', '威海'] }), { filters: { subject: '主人' } }) === null, '主体对得上的不许砍')
ok(mismatch(C({ entities: [] }), { filters: { subject: '主人' } }) === null, '候选没写主体时不许砍（宁漏）')
ok(mismatch(C({ entities: undefined }), { filters: { subject: '主人' } }) === null, 'entities 缺失时不许砍')
ok(mismatch(C({ entities: ['主人'] }), { filters: {} }) === null, '没指定主体时不许砍')
ok(negate(C({ summary: '主人喜欢下雨' }), '主人喜欢下雨吗') === null, '正面陈述不许砍')
ok(isFixture(C({ summary: '主人今天去公司加班' })) === false, '正常文本不许当夹具')

// ── 主流程：pass 里不许出现被砍的，suppressed 必须留痕 ──
const list = [
  C({ episodeId: 'keep1', summary: '主人住在威海', score: 3, entities: ['主人'] }),
  C({ episodeId: 'gone1', summary: '主人住在青岛', score: 2.9, state: 'retracted', entities: ['主人'] }),
  C({ episodeId: 'keep2', summary: '主人喜欢夜跑', score: 2.6, entities: ['主人'] }),
]
const r = apply(list, { query: '主人住哪', filters: {} }, {})
ok(r.kept.some((x) => x.episodeId === 'keep1'), '正常条目要留下')
ok(!r.kept.some((x) => x.episodeId === 'gone1'), '作废条目不许进 kept')
ok(r.suppressed.some((x) => x.id === 'gone1' && x.reason === 'negated'), '作废条目要在 suppressed 里留痕')
ok(floor([], [{ id: 'x', reason: 'negated' }], list).kept.length === 1, '砍空了要捞回一条（不许空手）')

console.log(fail ? `FAIL ${fail}` : 'PASS 抑制规则（作废/主体/时间/类型/否定 该砍；正常/未知主体/无筛选 不砍；留痕与下限）')
process.exit(fail ? 1 : 0)
