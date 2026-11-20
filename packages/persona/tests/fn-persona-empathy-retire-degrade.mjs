// E09 共情·情绪 / D07 模式退役 / D08 降级策略
import { empathy } from '../core/empathy.js'
import { retire, degrade } from '../core/degrade.js'

const fails = []
const ok = (c, m, d = '') => { if (!c) { fails.push(m + ' — ' + d); console.log('FAIL ' + m + (d ? ' — ' + d : '')) } }
const DAY = 86400000

// E09：被带走，但有先后
const e1 = empathy('闭嘴吧你烦不烦', {})
ok(e1.caught === true && e1.delta < 0, '对方发火该被带下去', JSON.stringify(e1))
ok(/沉了一下|跟着/.test(String(e1.line)), '共情的话要像人话', String(e1.line))
const e2 = empathy('哈哈太好了，中奖了', {})
ok(e2.caught === true && e2.delta > 0, '对方高兴该被带起来', JSON.stringify(e2))
const e3 = empathy('今天好烦，气死了', { pcc: { crisis: 0.8 } })
ok(e3.caught === false && e3.because === 'self-overflow', '自己崩着顾不上别人', JSON.stringify(e3))
const e4 = empathy('嗯', {})
ok(e4.caught === false, '淡淡的语气不传染', JSON.stringify(e4))
ok(empathy('帮我看下这个报错', {}).caught === false, '正事不传染', '')

// D07：不用的东西会退役
const items = [
  { key: '常听的歌', last: Date.now() - DAY, weight: 1 },
  { key: '去年的口头禅', last: Date.now() - 60 * DAY, weight: 1 },
]
const r = retire(items)
ok(r.retiredCount === 1, '只有久不用的退役', JSON.stringify(r.retired.map((x) => x.key)))
ok(r.kept.some((x) => x.key === '常听的歌'), '常用的留着', '')
ok(retire([]).retiredCount === 0, '空的不报错', '')
ok(retire([{ key: 'x', last: 0, weight: 0.1 }]).retiredCount === 1, '权重本来就低且久不用该退', '')
// 半衰：14 天内会掉，但没到退役线
const half = retire([{ key: 'y', last: Date.now() - 10 * DAY, weight: 1 }])
ok(half.kept.length === 1 && half.kept[0].weight < 1, '十天不用该掉权重', JSON.stringify(half.kept))

// D08：器官缺席就冻结，不编
const d1 = degrade({ organs: ['str', 'pcc'], present: ['str', 'pcc'] })
ok(d1.frozen === false, '都在就不冻结', JSON.stringify(d1))
const d2 = degrade({ organs: ['str', 'pcc'], present: ['str'] })
ok(d2.frozen === true, '缺一个该冻结', JSON.stringify(d2))
ok(d2.missing.includes('pcc'), '要指出缺哪个', JSON.stringify(d2.missing))
ok(d2.line === null, '冻结时不许编一句情绪', String(d2.line))

if (fails.length) process.exit(1)
console.log('PASS 共情+退役+降级（发火/高兴会被带；自己崩着顾不上；淡语气不传；久不用退役、十天掉权重；缺器官冻结不编）')
