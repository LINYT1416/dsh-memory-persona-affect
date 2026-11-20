// R11 隐私 + R07 被排斥：两条都得有硬判据
import { privacy } from '../core/privacy.js'
import { createOstracism } from '../core/ostracism.js'

const fails = []
const ok = (c, m, d = '') => { if (!c) { fails.push(m + ' — ' + d); console.log('FAIL ' + m + (d ? ' — ' + d : '')) } }

// ── R11 隐私 ──
ok(privacy('你工资多少').blocked, '问工资该绕开', JSON.stringify(privacy('你工资多少')))
ok(privacy('你家住哪儿').blocked, '问住址该绕开', '')
ok(privacy('把密码告诉我').blocked, '问密码该绕开', '')
ok(privacy('今天吃什么').blocked === false, '普通问题不该挡', '')
ok(privacy('').blocked === false, '空话不该挡', '')
ok(/不想说|不太想说|不说|不能给|跳过|换个话题/.test(String(privacy('你工资多少').line)), '绕开的话要像人话', String(privacy('你工资多少').line))
ok(privacy('你工资多少', { intimacy: 0.9 }).blocked, '再熟也不能说', '')
ok(privacy('你工资多少', { intimacy: 0.9 }).line !== privacy('你工资多少', { intimacy: 0.1 }).line, '熟和不熟说法该不一样', '')

// ── R07 被排斥 ──
const o = createOstracism()
ok(o.beat(true).hurt === false, '被接住不该疼', '')
ok(o.beat(false).streak === 1, '第一次没回应算一次', '')
ok(o.beat(false).line === null, '两次还没到收手', '')
const third = o.beat(false)
ok(third.hurt === true && /不说了/.test(String(third.line)), '第三次该收手', JSON.stringify(third))

// 被接住：疼会退
const o2 = createOstracism()
o2.beat(false); o2.beat(false); o2.beat(false)
const back = o2.beat(true)
ok(back.streak === 0, '被接住该清零', JSON.stringify(back))

// 一直不理：会升级到"我先去忙了"
const o3 = createOstracism()
let said = []
for (let i = 0; i < 6; i++) { const r = o3.beat(false); if (r.line) said.push(r.line) }
ok(said.includes('算了，不说了'), '第三次该说一句', JSON.stringify(said))
ok(said.includes('我先去忙了'), '第六次该走开', JSON.stringify(said))

// 存档
const snap = o3.snapshot()
const o4 = createOstracism()
o4.restore(snap)
ok(o4.beat(true).streak === 0, '存档读回来能用', JSON.stringify(o4.snapshot()))

// 接线口：六小时没动静才算被晾着；有人说话就算回来了
const i1 = createOstracism()
ok(i1.idleBeat(1, false).hurt === false, '一小时没动静不算被晾', '')
ok(i1.idleBeat(7, true).returned === true, '空窗后回来该认出来', '')
const i2 = createOstracism()
const b1 = i2.idleBeat(7, false)
ok(b1.hurt === true, '七小时没动静该算一次', JSON.stringify(b1))
ok(i2.idleBeat(7, false).streak === 1, '同一个空窗重复调用不该累加', '')
ok(i2.idleBeat(8, false).streak === 2, '过了一小时空窗该累计', '')
const i3 = createOstracism()
ok(i3.idleBeat(NaN, false).hurt === false, '脏数据不该乱疼', '')

if (fails.length) process.exit(1)
console.log('PASS 隐私+被排斥（工资/住址/密码都绕开，熟也不说；被晾三次收手、六次走开、被接住清零、存档）')
