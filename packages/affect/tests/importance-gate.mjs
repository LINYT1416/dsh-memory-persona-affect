// 记忆门槛：值不值得记，是算出来的，不是"全都存"。
import { importanceOf } from '../core/bridge.js'

let fail = 0
const ok = (cond, msg) => { if (!cond) { fail++; console.log('FAIL', msg) } }

ok(importanceOf('嗯') < 2, '寒暄「嗯」不该过门槛')
ok(importanceOf('重启完了') < 2, '口令「重启完了」不该过门槛')
ok(importanceOf('我不咋困诶') < 2, '闲话「我不咋困诶」不该过门槛')
ok(importanceOf('我想让记忆只记重要的，以后还能翻到') >= 2, '带偏好的话该过门槛')
ok(importanceOf('我叫小鱼，在杭州上班，养了一只猫叫团子') >= 2, '关于自己的事实该过门槛')
ok(importanceOf('今天好累啊，被那个客户折磨一天') >= 2, '带情绪的具体事件该过门槛')

console.log(fail ? `FAIL ${fail}` : 'PASS 记忆门槛（寒暄不进、偏好和事实进）')
process.exit(fail ? 1 : 0)
