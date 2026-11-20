import { pickRecall } from '../core/remember.js'
const now = 2_000_000_000_000
const DAY = 86400000
const same = '我说：修完了吗 我说：还没修完'
const eps = [
  { brief: same, at: now - 5 * DAY },
  { brief: same, at: now - 5 * DAY },
  { brief: same, at: now - 4 * DAY },
  { brief: '我说：另一句完全不同的旧事', at: now - 3 * DAY },
]
const got = pickRecall(eps, { now, max: 5 })
const fails = []
if (got.length !== 2) fails.push('重复条目没合并，实际 ' + got.length + '：' + JSON.stringify(got.map((g) => g.text)))
if (new Set(got.map((g) => g.text)).size !== got.length) fails.push('结果里还有重复')
if (fails.length) { fails.forEach((f) => console.log('FAIL ' + f)); process.exit(1) }
console.log('PASS 主动提起去重（4 条输入、2 句不同的话 → 出 ' + got.length + ' 条）')
