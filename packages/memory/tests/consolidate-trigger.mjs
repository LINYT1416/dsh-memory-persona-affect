// 巩固触发条件：不能只等"安静 30 分钟"。
import { shouldRunNow } from '../organs/hippocampus/lib/consolidate.js'

let fail = 0
const ok = (c, m) => { if (!c) { fail++; console.log('FAIL', m) } }
const now = 1_700_000_000_000
const MIN = 60 * 1000

// 没积压 → 不跑
ok(shouldRunNow({ pending: 0, now }) === false, '没有待巩固不该跑')

// 安静了 → 跑（哪怕只有 1 条）
ok(shouldRunNow({ pending: 1, quiet: true, now }) === true, '安静时应跑')

// 一直在聊天（不安静），但积压够多 → 必须跑
ok(shouldRunNow({ pending: 8, quiet: false, now, lastConsolidateAt: now - 1 * MIN }) === true, '积压 8 条应强跑')

// 积压不多、也不安静，但已经 25 分钟没跑了 → 跑
ok(shouldRunNow({ pending: 2, quiet: false, now, lastConsolidateAt: now - 25 * MIN }) === true, '超过 20 分钟应跑')

// 刚跑过、积压不多、也不安静 → 等下一轮
ok(shouldRunNow({ pending: 2, quiet: false, now, lastConsolidateAt: now - 2 * MIN }) === false, '刚跑过且积压不多应等')

// 从没跑过（lastConsolidateAt=0）且有积压 → 跑
ok(shouldRunNow({ pending: 1, quiet: false, now, lastConsolidateAt: 0 }) === true, '从未跑过且有积压应跑')

console.log(fail ? `FAIL ${fail}` : `PASS 巩固触发（安静/积压/超时/等待/首次）`)
process.exit(fail ? 1 : 0)
