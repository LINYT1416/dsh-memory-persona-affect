// 继承旧心情插件：字段映射必须对得上，且只继承状态、不继承历史。
//   node tests/inherit.mjs
import { mapLegacy, readLegacy } from '../core/inherit.js'

const fails = []
const ok = (c, m) => { if (!c) fails.push(m) }

const legacy = {
  v: 2,
  at: '2026-11-11T12:12:10.818Z',
  inner: { valence: 0.44, arousal: 0.25, energy: 1 },
  mask: 0.17,
  body: { hunger: 0.28, sleepDebt: 0.38, ache: 1 },
  mind: { social: 0.89, patience: -0.12, guard: -0.4, comfort: 0.31, pride: -0.33, focus: 0.96 },
  cycle: { len: 28, lastStart: '2026-10-26T10:25:26.908Z' },
  longTerm: { valence: 0.12, comfort: 0.1 },
  emotions: [],
}

const m = mapLegacy(legacy)
ok(Math.abs(m.mood - 0.44) < 1e-9, `心情应继承 0.44，实际 ${m.mood}`)
ok(m.organs.pfc.suppression === 0.17, '面具应继承 0.17')
ok(m.organs.pfc.bandwidth > 0.5 && m.organs.pfc.bandwidth < 0.85, `带宽应在合理区间，实际 ${m.organs.pfc.bandwidth}`)
ok(Math.abs(m.organs.hypothalamus.sleepDebt - 0.38) < 1e-9, '睡眠债应继承')
ok(Math.abs(m.organs.hypothalamus.hunger - 0.28) < 1e-9, '饥饿应继承')
ok(m.organs.social.trust > 0.7 && m.organs.social.trust <= 0.85, `信任应在 0.7~0.85，实际 ${m.organs.social.trust}`)
ok(m.organs.attention.focus === 0.96, '注意力应继承')
ok(m.organs.hypothalamus.cycleStart === legacy.cycle.lastStart, '周期起点应继承')
ok(m.meta.from === legacy.at, 'meta 应记录来源帧时间')
ok(!('trail' in m.organs), '不该继承历史轨迹')

// 坏数据不许炸
for (const bad of [null, {}, { v: 3 }, { inner: null }]) {
  let threw = false
  try { mapLegacy(bad) } catch { threw = true }
  ok(!threw, `坏数据不该抛：${JSON.stringify(bad)}`)
}

const real = readLegacy()
if (real) {
  const r = mapLegacy(real.state)
  ok(r.mood >= -1 && r.mood <= 1, '真实旧数据 mood 越界')
  ok(r.organs.social.trust <= 0.85, '真实旧数据 trust 越界')
}

console.log(fails.length ? `FAIL ${fails.length}:\n- ` + fails.join('\n- ') : `PASS 继承映射正确（真实旧数据${real ? '已读到' : '未找到，跳过'}）`)
process.exit(fails.length ? 1 : 0)
