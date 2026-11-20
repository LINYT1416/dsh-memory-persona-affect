// 退场索引降权：retired/shadowed 不删不拦，但别跟活跃记忆平起平坐抢座次。
// 实测依据：一次真实检索的 top4 全是 retired。
import { demote, apply, RETIRED_FACTOR } from '../organs/prefrontal/kernel/inhibit.js'

let fail = 0
const ok = (c, m) => { if (!c) { fail++; console.log('FAIL', m) } else { console.log('  ok:', m) } }
const E = (o) => ({ episodeId: 'e1', summary: '一条记忆', score: 1, ...o })

// 该降：retired / shadowed
{
  const { kept, demoted } = demote([E({ episodeId: 'r1', transferState: 'retired', score: 1 })])
  ok(demoted === 1, 'retired 要降权')
  ok(Math.abs(kept[0].score - RETIRED_FACTOR) < 1e-9, `retired 分数应 ×${RETIRED_FACTOR}（实际 ${kept[0].score}）`)
  ok(kept[0].retiredIndex === true, '要打 retiredIndex 标记，便于审计')
  ok(kept.length === 1, '降权不是删除，条目还在')
}
{
  const { demoted } = demote([E({ transferState: 'shadowed', score: 1 })])
  ok(demoted === 1, 'shadowed 也要降权')
}

// 不该降：held / 没这个字段
{
  const { kept, demoted } = demote([E({ transferState: 'held', score: 1 })])
  ok(demoted === 0, 'held 不降权')
  ok(kept[0].score === 1, 'held 分数不变')
}
{
  const { demoted } = demote([E({ score: 1 })])
  ok(demoted === 0, '没有 transferState 的不降权')
}

// 排序效果：分数接近时，活跃的应该排到退场的上面
{
  const list = [
    E({ episodeId: 'old', transferState: 'retired', summary: '旧的一条', score: 1.0 }),
    E({ episodeId: 'live', transferState: 'held', summary: '新的一条', score: 0.9 }),
  ]
  const r = apply(list, { query: '记忆', filters: {} }, {})
  const byId = new Map(r.kept.map((x) => [x.episodeId, x]))
  // apply 只负责改分，排序是 judge.rank 的事——所以这里验"分数关系"和"按分排序后的名次"
  ok(byId.get('old').score < byId.get('live').score, 'retired 的分要低于活跃条目')
  const ranked = [...r.kept].sort((a, b) => b.score - a.score).map((x) => x.episodeId)
  ok(ranked[0] === 'live', `按分排序后活跃的应排第一（实际 ${ranked.join(' > ')}）`)
  ok(r.demoted === 1, 'apply 要回报降了几条')
  ok(r.kept.length === 2, '两条都还在，不许因为退场就删')
}

// 不许误伤：全是 held 时一条都不许降
{
  const list = [E({ episodeId: 'a', transferState: 'held', score: 2 }), E({ episodeId: 'b', transferState: 'held', score: 1 })]
  const r = apply(list, { query: '记忆', filters: {} }, {})
  ok(r.demoted === 0, '全 held 时降权数应为 0')
  ok(r.kept.length === 2, '两条都要留')
}

console.log(fail ? `FAIL ${fail}` : 'PASS 退场降权（retired/shadowed 降分不删 / held 不动 / 排序生效 / 不误伤）')
process.exit(fail ? 1 : 0)
