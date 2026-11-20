// R06 嫉妒与占有：他跟别人也好，心里有点不是滋味（但要克制）
import { createPossess } from '../core/possess.js'

const fails = []
const ok = (c, m, d = '') => { if (!c) { fails.push(m + ' — ' + d); console.log('FAIL ' + m + (d ? ' — ' + d : '')) } }
const t0 = 1_800_000_000_000

const p = createPossess()
// 只提别人、不夸：不该吃醋
p.note('我同事今天也来了', t0)
ok(p.snapshot().jealousy === 0, '只提别人不该吃醋', JSON.stringify(p.snapshot()))

// 夸别人：吃醋
p.note('我朋友人挺好的，挺照顾我', t0 + 1000)
ok(p.snapshot().jealousy > 0, '夸别人该有点不是滋味', JSON.stringify(p.snapshot()))
ok(p.line(t0 + 2000) === null, '一次不够，不该马上说', String(p.line(t0 + 2000)))

// 攒够才说
p.note('我同事也很厉害', t0 + 3000)
const line = p.line(t0 + 4000)
ok(typeof line === 'string' && /别人也这么/.test(line), '攒够了应该说一句', String(line))

// 冷却：两小时内不再说
ok(p.line(t0 + 60_000) === null, '冷却内不该再说', String(p.line(t0 + 60_000)))

// 说了会消一点，不积累成怨气
ok(p.snapshot().jealousy < 0.5, '说完该降下来', JSON.stringify(p.snapshot()))

// 时间冲淡
const q = createPossess({ jealousy: 0.8, lastLineAt: t0 })
q.decay(t0 + 6 * 60 * 60 * 1000)
ok(q.snapshot().jealousy < 0.2, '六小时后该淡很多', JSON.stringify(q.snapshot()))

// 存档
const snap = p.snapshot()
const r = createPossess()
r.restore(snap)
ok(Math.abs(r.snapshot().jealousy - snap.jealousy) < 0.001, '存档读回来不一致', JSON.stringify(r.snapshot()))

if (fails.length) process.exit(1)
console.log('PASS 嫉妒与占有（只提别人不算 / 夸别人才算 / 攒够才说 / 两小时冷却 / 说完降下来 / 时间冲淡 / 存档可回）')
