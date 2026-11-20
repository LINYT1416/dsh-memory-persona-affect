// 真实存档回放：把 ~/.dsh/affect/state.json 的副本灌进引擎，按宿主的时钟往前推，
// 看威胁/心情到底降不降得下来。
//
//   node tests/fn-cooldown-live-replay.mjs              # 每拍 60s（宿主标称节拍）
//   node tests/fn-cooldown-live-replay.mjs --live-dt     # 用线上真实 dt 序列（大量 2s 一拍）
//   node tests/fn-cooldown-live-replay.mjs --debug       # 打每个阶段的威胁增量
//
// 只读 tests/fixtures/live-state.json，绝不写回 ~/.dsh/affect/。
//
// 断言（和线上同一个量纲）：
//   10 分钟：threat ≤ 0.25，mood ≥ -0.35
//   30 分钟：threat ≤ 0.20，mood ≥ -0.15
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { createEngine } from '../core/engine.js'

const here = dirname(fileURLToPath(import.meta.url))
const FIXTURE = join(here, 'fixtures', 'live-state.json')

const argv = process.argv.slice(2)
const LIVE_DT = argv.includes('--live-dt')
const DEBUG = argv.includes('--debug')

// 线上 /affect/trace 抓到的真实 dt（tx_15770→15850，毫秒）。
// 28 拍 ≈ 5 分钟：2s 一拍是常态（有东西在按 2 秒调 tick），夹着几次 60s。
const LIVE_DTS = [
  43375, 484, 42, 2873, 21, 310, 2966, 904, 30262, 60002, 74, 195, 29, 348,
  18, 2140, 4860, 1357, 34812, 2006, 1995, 2002, 2001, 1998, 2004, 2001, 2000,
  247, 1751, 2000, 2015, 1991, 1995, 50251, 60005, 60006, 47784, 2005, 1997,
  2008, 1993, 1999, 2000, 229, 9141, 345, 7894, 277, 110, 13, 16, 10, 1400,
  1210, 1097, 2114, 1259, 1587, 94, 6661, 91, 1055, 61, 5564, 97, 9046, 10,
  2318, 64, 2452, 21, 115, 444, 2691, 2744, 7228, 101, 30069, 857, 21741, 2212,
]

const fails = []
const ok = (c, m, d = '') => { if (!c) fails.push(`${m}${d ? `（${d}）` : ''}`) }
const f = (n, k = 3) => Number(n).toFixed(k)

const saved = JSON.parse(readFileSync(FIXTURE, 'utf8'))
let t = Number(saved.at)
const engine = createEngine({ now: () => t })
engine.restore(saved)

const amy = engine.organs.amygdala
const stageLog = []
let lastThreat = amy.read().threat

// 把各个"给威胁加一笔"的通路单独量出来：不改逻辑，只记录前后差。
// 只给 --debug 用；正常回放不动器官。
if (DEBUG) {
  const wrap = (name, fn) => {
    const orig = amy[name]
    if (typeof orig !== 'function') return
    amy[name] = function patch(...args) {
      const before = amy.read().threat
      const out = orig.apply(this, args)
      const after = amy.read().threat
      if (Math.abs(after - before) > 1e-9) stageLog.push({ stage: name, d: after - before })
      return out
    }
  }
  wrap('fast', amy.fast)
  wrap('step', amy.step)
  wrap('restore', amy.restore)
}

const sample = () => ({
  threat: amy.read().threat,
  mood: engine.state.mood,
  valence: engine.read()?.valence ?? 0,
  moodTarget: engine.read()?.moodTarget ?? 0,
  felt: engine.read()?.felt?.intensity ?? 0,
  frustration: amy.snapshot().frustration,
  ctxHome: amy.snapshot().context?.home ?? 0,
  reactivate: engine.organs.hippocampus.read().reactivate,
  echo: engine.read()?.memoryEcho ? (engine.read().memoryEcho.hits?.length ?? 0) : 0,
  echoTone: engine.read()?.memoryEcho?.tone ?? null,
  trust: engine.read()?.trust ?? 0,
  rum: engine.read()?.rumination ?? 0,
})

const start = sample()
console.log('起始（真实存档）:', JSON.stringify({
  threat: f(start.threat), mood: f(start.mood), frustration: f(start.frustration),
  ctxHome: f(start.ctxHome), 戒备: f(1 - start.trust),
}))
if (LIVE_DT) {
  // 线上那次观测是 tx_15787 → tx_15814（27 拍）。在这条序列里是从下标 17 开始的 28 个 dt。
  const win = LIVE_DTS.slice(17, 17 + 28)
  const sumWin = win.reduce((a, b) => a + b, 0)
  const sumAll = LIVE_DTS.reduce((a, b) => a + b, 0)
  console.log(`线上 dt 核对：tx_15787→15814 共 ${win.length} 拍、合计 ${(sumWin / 60_000).toFixed(2)} 分钟`
    + `（换算下来约 ${(sumWin / win.length / 1000).toFixed(1)} 秒一拍；整段序列平均 ${(sumAll / LIVE_DTS.length / 1000).toFixed(1)} 秒一拍）`)
}

const marks = []
const trace = []
let dtIdx = 0
let elapsed = 0
const TOTAL_MIN = 30
let nextMark = 0

function oneTick(dtMs) {
  t += dtMs
  elapsed += dtMs / 60_000
  engine.tick([])
  const s = sample()
  trace.push({ min: elapsed, ...s })
  while (nextMark <= elapsed + 1e-9 && nextMark <= TOTAL_MIN) {
    marks.push({ min: nextMark, ...s })
    nextMark += nextMark < 10 ? 1 : 5
  }
}

while (elapsed < TOTAL_MIN - 1e-9) {
  const dt = LIVE_DT ? LIVE_DTS[dtIdx++ % LIVE_DTS.length] : 60_000
  oneTick(Math.min(dt, Math.max(1000, (TOTAL_MIN - elapsed) * 60_000)))
}

console.log('\n分钟  threat   mood     戒备   valence  felt   frustration  反刍   回声')
for (const m of marks) {
  console.log(
    `${String(m.min).padStart(4)}  ${f(m.threat)}   ${String(f(m.mood)).padStart(6)}  ${f(1 - m.trust)}  ${String(f(m.valence)).padStart(7)}  ${f(m.felt)}   ` +
    `${f(m.frustration)}     ${f(m.rum)}   ${m.echo ? `${m.echo}条/tone=${f(m.echoTone, 2)}` : '无'}`,
  )
}
console.log('  （戒备 = 1 − social.trust，和仪表页「戒备」同一个来源；它不是 threat）')
const at = (min) => marks.find((m) => m.min === min) || trace.reduce((a, b) => (Math.abs(b.min - min) < Math.abs(a.min - min) ? b : a))

if (DEBUG) {
  const sum = {}
  for (const x of stageLog) sum[x.stage] = (sum[x.stage] || 0) + x.d
  const cnt = {}
  for (const x of stageLog) cnt[x.stage] = (cnt[x.stage] || 0) + 1
  console.log('\n各阶段累计威胁增量（正=加回来，负=压下去）:')
  for (const [k, v] of Object.entries(sum)) console.log(`  ${k.padEnd(8)} ${v >= 0 ? '+' : ''}${f(v)}   (${cnt[k]} 次)`)
  console.log(`  净变化 ${f(amy.read().threat - start.threat)}，总时长 ${f(elapsed)} 分钟`)
}

const m5 = at(5)
const m10 = at(10)
const m30 = at(30)
console.log(`\n5 分钟：threat=${f(m5.threat)} mood=${f(m5.mood)}（线上实测 threat≈1 / mood -0.649→-0.600）`)
console.log(`10 分钟：threat=${f(m10.threat)}（要求 ≤0.25）mood=${f(m10.mood)}（要求 ≥-0.35）`)
console.log(`30 分钟：threat=${f(m30.threat)}（要求 ≤0.20）mood=${f(m30.mood)}（要求 ≥-0.15）`)

ok(m10.threat <= 0.25, '10 分钟后 threat 应 ≤0.25', f(m10.threat))
ok(m10.mood >= -0.35, '10 分钟后 mood 应 ≥-0.35', f(m10.mood))
ok(m30.threat <= 0.2, '30 分钟后 threat 应 ≤0.20', f(m30.threat))
ok(m30.mood >= -0.15, '30 分钟后 mood 应 ≥-0.15', f(m30.mood))
// 单调性：威胁不该在安静期反复抬头（每 5 分钟取一个点看）
const news = [5, 10, 15, 20, 25, 30].map((x) => at(x).threat)
for (let i = 1; i < news.length; i += 1) {
  ok(news[i] <= news[i - 1] + 0.02, '安静期威胁不该反弹', `${news[i - 1]} → ${news[i]}`)
}

if (fails.length) {
  console.log(`\nFAIL ${fails.length}:`)
  for (const x of fails) console.log(' - ' + x)
  process.exit(1)
}
console.log('\nPASS 真实存档回放（10min threat≤0.25 / mood≥-0.35；30min threat≤0.20 / mood≥-0.15）')
