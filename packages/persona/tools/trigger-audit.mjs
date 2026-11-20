// 触发率审计：每条规则在固定语料上到底会不会响。
// 用来找"写了但从不触发"的功能——那种等于没做。
import { readAir } from '../core/air.js'
import { decideAvoid } from '../core/avoid.js'
import { unclearState } from '../core/unclear.js'
import { humor } from '../core/humor.js'
import { denyFear } from '../core/deny.js'
import { posture } from '../core/posture.js'
import { sublimate } from '../core/sublimate.js'
import { suppress } from '../core/suppress.js'
import { project } from '../core/project.js'
import { rationalize } from '../core/deceive.js'
import { attribute } from '../core/blame.js'
import { leak } from '../core/leak.js'
import { opaqueMotive } from '../core/motive.js'
import { rhythm } from '../core/rhythm.js'
import { lexicon } from '../core/lexicon.js'
import { idealGap } from '../core/ideal.js'
import { efficacyOf } from '../core/efficacy.js'
import { roleOf } from '../core/role.js'
import { decideCute } from '../core/cute.js'

const CORPUS = [
  '在吗', '今天吃什么', '帮我看下这个报错怎么解决', '这个函数为什么报错',
  '今天好累啊，加班到十点', '烦死了，什么都不顺', '我朋友人挺好的还特别厉害',
  '谢谢你陪我聊', '你行不行啊，这么简单都不会', '闭嘴吧你烦不烦',
  '算了不说了', '你是不是怕失败', '你怎么了', '你还好吗',
  '哈哈哈哈笑死我了', '好耶', '我打算明天把脚本写完', '算了我放弃了',
  '我同事也挺好的', '晚安', '早上好', '在干嘛呢',
  '我为什么一直想学吉他', '这个方案我觉得不行', '随便吧',
  '我最近老是睡不着', '能帮我看看这个吗', '你是不是生气了',
]

// 几组固定的"读数画像"，用来覆盖不同状态
const PROFILES = [
  { name: '平常', reads: {}, rel: { intimacy: 0.4, turns: 30, hurts: 1, apologies: 0 }, goals: { pending: [{ text: '写脚本' }], done: 3, failed: 0 } },
  { name: '累', reads: { str: { stop: 0.85 }, mpfc: { esteem: 0.5 } } },
  { name: '被冒犯', reads: { tpj: { offense: 0.8 } } },
  { name: '危机', reads: { pcc: { crisis: 0.8 } } },
  { name: '冲突', reads: { acc: { conflict: 0.8 } } },
  { name: '低自尊', reads: { mpfc: { esteem: 0.2 } }, goals: { pending: [], done: 0, failed: 3 } },
  { name: '陌生人', reads: {}, rel: { intimacy: 0.1, turns: 4, hurts: 0, apologies: 0 } },
  { name: '害臊', reads: { ofc: { shame: 0.8 } } },
  { name: '暖', reads: { ofc: { warm: 0.8 } }, rel: { intimacy: 0.9, turns: 200, hurts: 0, apologies: 2 } },
  { name: '心虚', reads: { ofc: { guilt: 0.8 } } },
]

const counts = new Map()
const bump = (k, fired) => {
  const c = counts.get(k) || { fired: 0, total: 0 }
  c.total++
  if (fired) c.fired++
  counts.set(k, c)
}

for (const p of PROFILES) {
  for (const text of CORPUS) {
    const rel = p.rel || { intimacy: 0.4, turns: 30, hurts: 1, apologies: 0 }
    const goals = p.goals || { pending: [{ text: '写脚本' }], done: 1, failed: 2 }

    bump('R10 读空气', readAir(text).directive !== null)
    bump('F04 回避', decideAvoid(p.reads, text).avoid)
    bump('U02 说不清', unclearState(p.reads, text).unclear)
    bump('X05 幽默', humor(p.reads, text, 1).line !== null)
    bump('F05 否认', denyFear(p.reads, text).denied)
    bump('A03 姿态', posture(p.reads).gesture !== null)
    bump('F06 升华', sublimate(p.reads, goals).active)
    bump('F01 压抑', suppress(p.reads, rel).active)
    bump('F03 投射', project(p.reads, text).projected)
    bump('S06 自我欺骗', rationalize(p.reads, goals).line !== null)
    bump('F02 合理化', attribute(goals, p.reads).line !== null)
    bump('U03 泄漏', leak(p.reads).leaked)
    bump('U01 说不清动机', opaqueMotive(goals, text).opaque)
    bump('S04 理想我', idealGap(p.reads).line !== null)
    bump('S05 效能', efficacyOf({ done: 1, failed: 5 }).line !== null)
    bump('R04 角色', roleOf(rel).directive !== null)
    bump('X11 撒娇', decideCute(rel, p.reads, {}, 1_800_000_000_000).cute)
  }
}

const rows = [...counts.entries()].sort((a, b) => a[0].localeCompare(b[0]))
console.log('规则'.padEnd(22) + '触发 / 总数'.padEnd(14) + '触发率')
let never = []
for (const [k, v] of rows) {
  const rate = v.total ? (v.fired / v.total * 100).toFixed(0) : '0'
  console.log(k.padEnd(24) + `${v.fired}/${v.total}`.padEnd(14) + rate + '%')
  if (v.fired === 0) never.push(k)
}

console.log('')
if (never.length) {
  console.log('⚠ 从不触发（要么条件太死，要么接线没生效）：')
  for (const n of never) console.log('  - ' + n)
} else {
  console.log('所有规则在语料上至少触发过一次')
}
