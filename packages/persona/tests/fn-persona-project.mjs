// F03 投射：自己的情绪放到对方身上；对方真生气时不成立
import { project } from '../core/project.js'

const fails = []
const ok = (c, m, d = '') => { if (!c) { fails.push(m + ' — ' + d); console.log('FAIL ' + m + (d ? ' — ' + d : '')) } }

// 平常：不投射
const none = project({}, '今天吃什么')
ok(none.projected === false && none.line === null, '平常不该投射', JSON.stringify(none))

// 她被冒犯、对方没情绪：投射成"你是不是生气"
const off = project({ tpj: { offense: 0.8 } }, '哦')
ok(off.projected === true && /生气/.test(String(off.line)), '被冒犯时该投射', JSON.stringify(off))

// 对方真在生气：不许再说"你是不是生气"（那不是投射，是明知故问）
const real = project({ tpj: { offense: 0.8 } }, '闭嘴吧你烦不烦')
ok(real.projected === false && real.because === 'other-really-angry', '对方真生气时不该投射', JSON.stringify(real))

// 心虚：投射成"你是不是在怪我"
const guilt = project({ ofc: { guilt: 0.8 } }, '嗯')
ok(guilt.projected === true && /怪/.test(String(guilt.line)), '心虚时该投射', JSON.stringify(guilt))

// 脏数据
const junk = project({ tpj: { offense: 'x' }, ofc: { guilt: NaN } }, '')
ok(junk.projected === false, '脏数据不该投射', JSON.stringify(junk))

if (fails.length) process.exit(1)
console.log('PASS 投射（被冒犯→问对方生气；心虚→问对方怪不怪；对方真生气时不投射；平常不投射）')
