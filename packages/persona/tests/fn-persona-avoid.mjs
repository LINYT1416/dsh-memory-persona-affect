// F04 回避：不想聊就绕开，别硬聊也别追问
import { decideAvoid } from '../core/avoid.js'

const fails = []
const ok = (c, m, d = '') => { if (!c) { fails.push(m + ' — ' + d); console.log('FAIL ' + m + (d ? ' — ' + d : '')) } }

// 身份危机：绕开
const crisis = decideAvoid({ pcc: { crisis: 0.8 } }, '我还想再聊聊这个')
ok(crisis.avoid === true && /先不聊/.test(String(crisis.line)), '危机时该绕开', JSON.stringify(crisis))

// 被冒犯到高点：换话题
const hit = decideAvoid({ tpj: { offense: 0.8 } }, '接着说啊')
ok(hit.avoid === true && /换个话题/.test(String(hit.line)), '被冒犯该换话题', JSON.stringify(hit))

// 害臊：打岔
const shame = decideAvoid({ ofc: { shame: 0.8 } }, '你说说看')
ok(shame.avoid === true && /不说了/.test(String(shame.line)), '害臊时该打岔', JSON.stringify(shame))

// 对方说"算了不说了"：尊重，不追问
const stop = decideAvoid({}, '算了不说了')
ok(stop.avoid === true && /不问了/.test(String(stop.line)), '对方不想说时不该追问', JSON.stringify(stop))

// 但"算了"如果是正事里的退款/取消，不该被当成情绪
const serious = decideAvoid({}, '算了，帮我把那个脚本删了')
ok(serious.avoid === false, '正事里的"算了"不该当情绪', JSON.stringify(serious))

// 平常：不回避
const plain = decideAvoid({}, '今天吃什么')
ok(plain.avoid === false && plain.line === null, '平常不该回避', JSON.stringify(plain))

// 脏数据
const junk = decideAvoid({ pcc: { crisis: 'x' } }, '')
ok(junk.avoid === false, '脏数据不该误判', JSON.stringify(junk))

if (fails.length) process.exit(1)
console.log('PASS 回避（危机/被冒犯/害臊各自绕开；对方喊停不追问；正事的"算了"不算情绪；平常不回避）')
