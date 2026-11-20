// M11 目标结果：成了 / 黄了 / 还悬着
import { createGoals } from '../core/goal.js'

const fails = []
const ok = (c, m, d = '') => { if (!c) { fails.push(m + ' — ' + d); console.log('FAIL ' + m + (d ? ' — ' + d : '')) } }
const t0 = 1_800_000_000_000

const g = createGoals()
// 随口一句不算目标
g.note('我想吃火锅', t0)
ok(g.snapshot().pending.length === 0, '随口一句不该算目标', JSON.stringify(g.snapshot()))

// 明确的打算才算
const r1 = g.note('我打算去把那个脚本改完', t0)
ok(r1.changed && r1.pending === 1, '明确打算应该记成悬着的', JSON.stringify(r1))

// 同一句不重复记
g.note('我打算去把那个脚本改完', t0 + 1000)
ok(g.snapshot().pending.length === 1, '同一句不该重复记', JSON.stringify(g.snapshot()))

// 成了
g.note('改完了，过了', t0 + 2000)
let s = g.snapshot()
ok(s.pending.length === 0 && s.done === 1, '成了应该消掉悬案并计数', JSON.stringify(s))
ok(/办成了/.test(String(g.line(t0 + 3000))), '刚成该说一句', String(g.line(t0 + 3000)))

// 黄了
const g2 = createGoals()
g2.note('我准备去跑个半马', t0)
g2.note('算了不去了，黄了', t0 + 1000)
s = g2.snapshot()
ok(s.failed === 1, '黄了应该计数', JSON.stringify(s))
ok(/没成/.test(String(g2.line(t0 + 2000))), '黄了该说一句', String(g2.line(t0 + 2000)))

// 悬太久
const g3 = createGoals()
g3.note('我打算去把牙看了', t0)
ok(/还悬着/.test(String(g3.line(t0 + 7 * 60 * 60 * 1000))), '悬超过 6 小时该提一句', String(g3.line(t0 + 7 * 60 * 60 * 1000)))
ok(g3.line(t0 + 60 * 1000) === null, '刚记下不该马上念', String(g3.line(t0 + 60 * 1000)))

// 存档
const g4 = createGoals()
g4.note('我打算去学个新东西', t0)
const snap = g4.snapshot()
const g5 = createGoals()
g5.restore(snap)
ok(g5.snapshot().pending.length === 1, '存档读回来丢了', JSON.stringify(g5.snapshot()))

if (fails.length) process.exit(1)
console.log('PASS 目标结果（随口不算 / 打算记悬着 / 成了黄了各自计数 / 悬 6 小时才提 / 存档可回）')
