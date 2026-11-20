// 影子判定：只算不做。三元指纹比现判定更严，先看差多少。
import { shadowJudge, participantsOf } from '../organs/hippocampus/lib/shadow.js'

let fail = 0
const ok = (c, m) => { if (!c) { fail++; console.log('FAIL', m) } }

const now = 1_700_000_000_000
const mk = (id, end, extra = {}) => ({ id, end, start: end - 60000, type: 'event', place: '', summary: '', ...extra })

// 1) 时间差超过 20 分钟 → distinct
const far = shadowJudge({ role: 'user', text: '我在卧安做测试' }, [mk('a', now - 3600000)], { at: now })
ok(far.kind === 'distinct', `超出时间窗应判 distinct，实际 ${far.kind}`)

// 2) 参与者、地点、类型都对上 → same
const near = shadowJudge(
  { role: 'user', text: '我在公司改打印机', type: 'event', place: '公司' },
  [mk('b', now - 60000, { type: 'event', place: '公司', summary: '公司打印机卡纸' })],
  { at: now },
)
ok(near.kind === 'same', `三者一致应判 same，实际 ${near.kind} score=${near.best?.score}`)

// 3) 地点不同 → 不该判 same
const diffPlace = shadowJudge(
  { role: 'user', text: '我在公司改打印机', type: 'event', place: '公司' },
  [mk('c', now - 60000, { type: 'event', place: '家', summary: '家里打印机卡纸' })],
  { at: now },
)
ok(diffPlace.kind === 'distinct', `地点不同应 distinct，实际 ${diffPlace.kind} score=${diffPlace.best?.score}`)

// 4) 类型不同 → 不该判 same
const diffType = shadowJudge(
  { role: 'user', text: '我在公司改打印机', type: 'event', place: '公司' },
  [mk('d', now - 60000, { type: 'emotion', place: '公司', summary: '公司让我很烦' })],
  { at: now },
)
ok(diffType.kind === 'distinct', `类型不同应 distinct，实际 ${diffType.kind} score=${diffType.best?.score}`)

// 5) 参与者判定
ok(participantsOf({ role: 'user', text: '我和同事去吃饭' }).includes('third-party'), '提到同事应识别第三方')
ok(participantsOf({ role: 'user', text: '今天下雨' }).join() === 'owner', '纯自述只有 owner')

// 6) 影子判定不改输入
const input = { role: 'user', text: '我在公司改打印机', type: 'event', place: '公司' }
const before = JSON.stringify(input)
shadowJudge(input, [mk('e', now - 60000, { type: 'event', place: '公司', summary: '公司打印机卡纸' })], { at: now })
ok(JSON.stringify(input) === before, '影子判定不应修改输入')

console.log(fail ? `FAIL ${fail}` : `PASS 影子判定（时间窗/三元一致/地点类型冲突/参与者/不改输入）`)
process.exit(fail ? 1 : 0)
