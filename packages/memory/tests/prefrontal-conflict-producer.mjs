// 冲突队列必须有生产者：judge 算出的冲突对要落库，裁决器才不是空转。
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const TMP = mkdtempSync(join(tmpdir(), 'pf-conf-'))
process.env.PREFrontal_DIR = TMP

const conflicts = await import('file:///E:/memory/dsh-all/organs/prefrontal/store/conflicts.js')
const { FILES } = await import('file:///E:/memory/dsh-all/organs/prefrontal/store/paths.js')

let fail = 0
const ok = (c, m) => { if (!c) { fail++; console.log('FAIL', m) } else { console.log('  ok:', m) } }

const pair = { aId: 'ep_a', bId: 'ep_b', entity: '主人', field: 'place', values: ['威海', '青岛'], kind: 'conflict' }
const rows = await conflicts.enqueue([pair])
ok(rows.length === 1, 'enqueue 要返回入库行')
ok(existsSync(FILES.conflicts), `队列文件要真的写出来（${FILES.conflicts}）`)
const s = conflicts.stats()
ok(s.total >= 1, `stats.total 应 ≥1（实际 ${s.total}）`)
ok(s.open >= 1, '新冲突状态应为 open')

// 幂等：同一条重复入队不重复记
await conflicts.enqueue([pair])
ok(conflicts.stats().total === 1, '同一 key 不重复入队')

// 派发：没有裁决人时到期只能标 expired，不许当已解决
await conflicts.dispatch(Date.now() + 10 * 86400000, { cortex: false })
const after = conflicts.stats()
ok(after.open === 0 && after.expired >= 1, '无裁决人：到期标 expired，不是 resolved')
ok(after.resolved === 0, '不许伪装成已解决')

// 源码层护栏：judge 出口必须把 conflicts 交给 enqueue，删了会退回空转
const idx = readFileSync('E:/memory/dsh-all/organs/prefrontal/index.js', 'utf8')
ok(/conflicts\.enqueue\(r\.conflicts\)/.test(idx), 'judgeOf 里要有 conflicts.enqueue(r.conflicts)')

rmSync(TMP, { recursive: true, force: true })
console.log(fail ? `FAIL ${fail}` : 'PASS 冲突队列（入库/幂等/派发/不伪装已解决/judge 有生产者）')
process.exit(fail ? 1 : 0)
