// 复现：线上「没人说话」时账本自己长、威胁钉住不降。
// 用 ~/.dsh/affect/state.json 的**副本**（绝不写回），按线上节拍（2s 一拍）推进 4 分钟。
//
//   node tests/repro-live-empty-tick.mjs                 # 空 events（面板 /affect/live 的轮询节拍）
//   node tests/repro-live-empty-tick.mjs --echo          # 空 events + 一条回声（上一句助手文本）
//   node tests/repro-live-empty-tick.mjs --src <path>    # 换一份存档
//
// 只读存档：引擎在内存里跑，跑完把账本/威胁曲线打出来。
import { readFileSync, existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { createEngine } from '../core/engine.js'

const argv = process.argv.slice(2)
const flag = (name) => argv.includes(`--${name}`)
const value = (name, dflt) => {
  const i = argv.indexOf(`--${name}`)
  return i >= 0 && argv[i + 1] ? argv[i + 1] : dflt
}

const SRC = value('src', join(homedir(), '.dsh', 'affect', 'state.json'))
if (!existsSync(SRC)) {
  console.error(`没有存档：${SRC}`)
  process.exit(2)
}
const saved = JSON.parse(readFileSync(SRC, 'utf8'))

// 线上节拍：面板 /affect/live 每 2s 一拍
const DT = 2000
const MINUTES = 4
const TICKS = Math.round((MINUTES * 60_000) / DT)

let t = Number(saved.at)
const engine = createEngine({ now: () => t })
engine.restore(saved)

const amy = engine.organs.amygdala
const before = {
  ledger: (engine.state.ledger || []).length,
  threat: Number(amy.read().threat || 0),
  frustration: Number(amy.snapshot().frustration || 0),
  grudge: Number(engine.grudge?.() ?? engine.state.grudge ?? 0),
}

const curve = []
const ledgerGain = []
let prevLedger = before.ledger
for (let i = 0; i < TICKS; i += 1) {
  t += DT
  const evs = []
  if (flag('echo')) {
    evs.push({ type: 'assistant', text: '嗯，我在。', at: t })
  }
  engine.tick(evs)
  const n = (engine.state.ledger || []).length
  if (n !== prevLedger) ledgerGain.push({ sec: (i + 1) * 2, from: prevLedger, to: n })
  prevLedger = n
  if ((i + 1) % 15 === 0 || i === 0) {
    curve.push({
      sec: (i + 1) * 2,
      threat: Number(amy.read().threat || 0),
      frustration: Number(amy.snapshot().frustration || 0),
      ledger: n,
      grudge: Number(engine.grudge?.() ?? engine.state.grudge ?? 0),
    })
  }
}

console.log(`存档：${SRC}`)
console.log(`起始：threat=${before.threat.toFixed(4)} frustration=${before.frustration.toFixed(4)} grudge=${before.grudge.toFixed(5)} ledger=${before.ledger}`)
console.log(`模式：${flag('echo') ? '空 events + 回声' : '空 events'}，${TICKS} 拍 × ${DT}ms = ${MINUTES} 分钟\n`)
console.log('  秒   threat  frustr  ledger  grudge')
for (const c of curve) {
  console.log(`  ${String(c.sec).padStart(4)}  ${c.threat.toFixed(4)}  ${c.frustration.toFixed(4)}  ${String(c.ledger).padStart(6)}  ${c.grudge.toFixed(5)}`)
}
const after = {
  ledger: (engine.state.ledger || []).length,
  threat: Number(amy.read().threat || 0),
}
console.log(`\n账本：${before.ledger} → ${after.ledger}（增长 ${after.ledger - before.ledger}）`)
if (ledgerGain.length) console.log('增长点：' + ledgerGain.slice(0, 12).map((x) => `${x.sec}s`).join(', ') + (ledgerGain.length > 12 ? ` …共 ${ledgerGain.length} 次` : ''))
console.log(`威胁：${before.threat.toFixed(4)} → ${after.threat.toFixed(4)}`)
