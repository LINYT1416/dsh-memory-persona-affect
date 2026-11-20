import { isRecallDue } from '../core/remember.js'
const cases = [[0, undefined, false], [1, undefined, true], [1, 0, false], [12, 0, true], [1503, 1500, false], [1512, 1500, true]]
const fails = []
for (const [tick, last, want] of cases) {
  const got = isRecallDue(tick, last)
  if (got !== want) fails.push('tick=' + tick + ' last=' + last + ' 期望 ' + want + ' 实际 ' + got)
}
if (fails.length) { fails.forEach((f) => console.log('FAIL ' + f)); process.exit(1) }
console.log('PASS 节流（首拍就能提；之后隔 12 拍；第 0 拍不提）')