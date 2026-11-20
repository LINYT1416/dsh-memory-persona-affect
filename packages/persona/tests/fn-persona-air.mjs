// R10 读空气：对方在火头上/在难受/在说正事/在闹着玩
import { readAir } from '../core/air.js'

const fails = []
const ok = (c, m, d = '') => { if (!c) { fails.push(m + ' — ' + d); console.log('FAIL ' + m + (d ? ' — ' + d : '')) } }

const angry = readAir('闭嘴吧你烦不烦')
ok(angry.air === 'angry' && /别接玩笑/.test(angry.directive), '发火该先收着', JSON.stringify(angry))

const vent = readAir('今天好累，撑不住了')
ok(vent.air === 'venting' && /别讲道理/.test(vent.directive), '诉苦时不该讲道理', JSON.stringify(vent))

const serious = readAir('帮我看下这个报错怎么解决')
ok(serious.air === 'serious' && /答清楚/.test(serious.directive), '正事该正经答', JSON.stringify(serious))

const play = readAir('哈哈笑死我了')
ok(play.air === 'playful' && play.directive === null, '闹着玩不用给指令', JSON.stringify(play))

const casual = readAir('嗯')
ok(casual.air === 'casual' && casual.directive === null, '平常不该给指令', JSON.stringify(casual))

// 发火优先于正事：带刺的技术问题也先收
const mixed = readAir('你到底会不会写代码')
ok(mixed.air === 'angry', '带刺该先判成发火', JSON.stringify(mixed))

// 空输入不炸
const empty = readAir('')
ok(empty.air === 'casual', '空输入应该算平常', JSON.stringify(empty))

if (fails.length) process.exit(1)
console.log('PASS 读空气（发火→收着；诉苦→别讲道理；正事→答清楚；闹着玩/平常→无指令；带刺优先；空输入不炸）')
