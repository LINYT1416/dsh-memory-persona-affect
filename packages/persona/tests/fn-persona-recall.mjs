import { pickRecall } from '../core/remember.js'
const now = 2_000_000_000_000
const DAY = 86400000
const eps = [
  { brief: '我说：面吃上了，有点咸但真香', at: now - 5 * DAY },
  { brief: '我说：刚想起来这句太新了', at: now - 1000 },
  { brief: '【情绪】委屈：他说你行不行啊', at: now - 6 * DAY },
  { brief: '短', at: now - 7 * DAY },
  { brief: '她说：你今天去哪儿了', at: now - 4 * DAY },
]
const got = pickRecall(eps, { now })
const fails = []
if (got.length !== 1) fails.push('应该只挑出 1 条，实际 ' + got.length + '：' + JSON.stringify(got))
if (!got[0]?.line?.startsWith('突然想起')) fails.push('措辞不对：' + got[0]?.line)
if (/太新/.test(got[0]?.line || '')) fails.push('太新的不该被挑：' + got[0]?.line)
if (/情绪/.test(got[0]?.line || '')) fails.push('情绪条目不该被挑：' + got[0]?.line)
const used = new Set([got[0]?.text])
const again = pickRecall(eps, { now, used })
if (again.some((x) => x.text === got[0]?.text)) fails.push('提过的还再提：' + JSON.stringify(again))
const only = [{ brief: got[0]?.text || '我说：面吃上了', at: now - 5 * DAY }]
if (pickRecall(only, { now, used }).length !== 0) fails.push('只有那一条时，提过也还再提')
if (fails.length) { fails.forEach((f) => console.log('FAIL ' + f)); process.exit(1) }
console.log('PASS 主动提起（' + got[0].line + '；太新/情绪/太短/提过 都不挑）')
