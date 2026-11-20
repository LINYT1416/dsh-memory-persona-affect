// 需求漂移必须是"按时间"的，不能按拍数
// 之前饥饿里挂了常数 +0.05：面板每秒刷一次就涨 5 个点，看着像发疯。
import { createEngine } from '../core/engine.js'

const fails = []
const ok = (c, m) => { if (!c) fails.push(m) }

let t = new Date(2026, 10, 12, 15, 0, 0).getTime()
const e = createEngine({ now: () => t })
// 先走一拍，让 fused 存在（否则读不到 needs）
e.tick([])

const readHunger = () => Number(e.read()?.needs?.hunger ?? NaN)
const readSleep = () => Number(e.read()?.needs?.sleep ?? NaN)

const h0 = readHunger()
ok(Number.isFinite(h0), '第一拍应当能读到饥饿值')

// 模拟面板每秒轮询一次，共 60 拍 = 1 分钟
for (let i = 0; i < 60; i += 1) { t += 1000; e.tick([]) }
const h1 = readHunger()
const d1 = h1 - h0
ok(d1 >= 0 && d1 < 0.005, `60 拍（1 分钟）饥饿涨了 ${d1.toFixed(5)}，应当 < 0.005`)

// 再过 1 小时：应当涨到接近 hungerRate（0.06 上下）
t += 3600_000
e.tick([])
const h2 = readHunger()
const d2 = h2 - h1
ok(d2 > 0.03 && d2 < 0.12, `1 小时饥饿涨了 ${d2.toFixed(4)}，应当在 0.03~0.12`)

// 困意：短时间不该跳
const s1 = readSleep()
for (let i = 0; i < 30; i += 1) { t += 1000; e.tick([]) }
const s2 = readSleep()
ok(Math.abs(s2 - s1) < 0.005, `30 拍困意变了 ${(s2 - s1).toFixed(5)}，应当 < 0.005`)

if (fails.length) {
  console.log(`FAIL ${fails.length}:`)
  for (const f of fails) console.log(' - ' + f)
  process.exit(1)
}
console.log(`PASS 需求按时间漂移（1 分钟 ${(d1 * 100).toFixed(3)} 点；1 小时 ${(d2 * 100).toFixed(1)} 点）`)
process.exit(0)
