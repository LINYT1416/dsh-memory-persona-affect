// 规则"能不能真的响"审计：喂一大段情绪跨度很大的对话，看哪条规则从头到尾没触发过。
// 用法：node tools/rule-audit.mjs
import { createEngine } from '../core/engine.js'
import { RULES } from '../core/desc.js'

const convo = [
  '在吗', '今天好累啊', '老板又让我加班到十点', '你行不行啊这么简单都不会',
  '算了不说了', '哎你刚才说的那个我试了', '还是不行', '谢谢你陪我聊',
  '我先去洗澡了', '明天再说吧', '草', '这也太离谱了吧',
  '我好像搞砸了', '对不起', '不是你的问题', '哈哈哈哈笑死',
  '你说我是不是很笨', '算了无所谓了', '晚上吃啥', '我想吃火锅',
  '好久没这么放松了', '你猜我今天遇到谁了', '服了', '你别生气啊',
  '我有点困了', '晚安', '早上好', '又下雨了', '地铁好挤', '我刚到家',
]

const engine = createEngine({})
const fired = new Map()

// 每一拍看一眼所有规则，记录是否越过阈值
for (const t of convo) {
  engine.tick([{ type: 'user', text: t }], 'audit')
  const reads = (engine.read() || {}).reads || {}
  for (const r of RULES) {
    let v = 0
    try { v = Number(r.v(reads)) || 0 } catch { v = 0 }
    if (v / r.at >= 1) fired.set(r.id, (fired.get(r.id) || 0) + 1)
  }
}

const never = RULES.filter((r) => !fired.has(r.id)).map((r) => r.id)
const once = RULES.filter((r) => fired.get(r.id) === 1).map((r) => r.id)

console.log('规则总数:', RULES.length)
console.log('30 句里触发过的:', fired.size)
console.log('一次都没触发:', never.length)
console.log('  ' + never.join(', '))
console.log('只触发过一次（勉强）:', once.length)
console.log('  ' + once.join(', '))
console.log('\n触发次数排行:')
;[...fired.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).forEach(([id, n]) => console.log('  ' + id + ' × ' + n))
