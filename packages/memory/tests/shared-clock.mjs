// 一拍定所有：dsh-all 内部只允许一个时钟
//
// 旧做法：杏仁核 5 分钟、皮层 5 分钟、海马 10 分钟各起一个 setInterval，
// 夜里还各有一个"每 30 分钟看一眼是不是 3 点"——3:00 和 3:30 都会触发一次深巩固。
//
//   node tests/shared-clock.mjs
import { every, dailyAt, pump, stats, reset } from '../lib/clock.js'

const fails = []
const ok = (c, m) => { if (!c) fails.push(m) }

const T0 = new Date('2026-11-12T00:00:00+08:00').getTime()
const MIN = 60_000

// ── 1. 各按各的周期到点 ─────────────────────────────────
{
  reset()
  const hits = { a: 0, c: 0, h: 0 }
  every('amygdala', 5 * MIN, () => { hits.a++ })
  every('cortex', 5 * MIN, () => { hits.c++ })
  every('hippocampus', 10 * MIN, () => { hits.h++ })

  // 第一拍在注册时刻 + 周期之后；这里手动按分钟推，模拟 30 分钟
  const start = Date.now()
  for (let m = 1; m <= 30; m++) pump(start + m * MIN)

  ok(hits.a === 6, `杏仁核 30 分钟该跑 6 次，实际 ${hits.a}`)
  ok(hits.c === 6, `皮层 30 分钟该跑 6 次，实际 ${hits.c}`)
  ok(hits.h === 3, `海马 30 分钟该跑 3 次，实际 ${hits.h}`)
}

// ── 2. 同一时刻重复 pump 不许重复跑 ─────────────────────
{
  reset()
  let n = 0
  every('x', 5 * MIN, () => { n++ })
  const t = Date.now() + 6 * MIN
  pump(t)
  pump(t)
  pump(t)
  ok(n === 1, `同一时刻连推三次，只该跑一次，实际 ${n}`)
}

// ── 3. 跳过很久也只补一次（不许补一串把 IO 打满）────────
{
  reset()
  let n = 0
  every('y', 5 * MIN, () => { n++ })
  pump(Date.now() + 3 * 3600_000) // 隔了 3 小时
  ok(n === 1, `隔 3 小时只该补跑一次，实际 ${n}`)
}

// ── 4. 夜间任务：一天一次，不是"3 点这一小时里撞几次算几次" ─
{
  reset()
  let deep = 0
  dailyAt('deep', 3, () => { deep++ }, { now: T0 })

  // 从 00:00 推到次日 23:00，按分钟推
  for (let m = 0; m <= 48 * 60; m++) pump(T0 + m * MIN)

  ok(deep === 2, `两天该深巩固 2 次，实际 ${deep}（旧实现 3:00 与 3:30 会各打一次 → 4 次）`)
}

// ── 5. 有任务抛错，不许拖累别的 ─────────────────────────
{
  reset()
  let good = 0
  every('bad', MIN, () => { throw new Error('炸') })
  every('good', MIN, () => { good++ })
  const t = Date.now() + 2 * MIN
  pump(t)
  ok(good === 1, `坏任务炸了，好任务该照跑，实际 ${good}`)
}

// ── 6. stats 能看出每个任务下一次什么时候到 ─────────────
{
  reset()
  every('s', 5 * MIN, () => {})
  const st = stats()
  ok(st.jobs.length === 1, `stats 该列 1 个任务，实际 ${st.jobs.length}`)
  ok(st.jobs[0].nextInMs > 0 && st.jobs[0].nextInMs <= 5 * MIN, `nextInMs 越界：${st.jobs[0].nextInMs}`)
}

reset()

if (fails.length) {
  console.log(`FAIL ${fails.length}:`)
  for (const f of fails) console.log(' - ' + f)
  process.exit(1)
}
console.log('PASS 一个时钟（5/5/10 分钟各按其周期；重复推不重跑；跳过只补一次；夜间一天一次；坏任务不拖累）')
process.exit(0)
