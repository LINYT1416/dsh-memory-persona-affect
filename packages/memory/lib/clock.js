// dsh-all 的拍子：一个时钟，多个到期点。
//
// 以前每个器官各起一个 setInterval（杏仁核 5 分钟、皮层 5 分钟、海马 10 分钟），
// 夜里还各有一个"每 30 分钟看一眼是不是 3 点"的轮询——同一个小时会打两次。
// 现在统一成一个 60 秒的拍子，到点就跑，错过不补跑一串。
//
// 为什么"错过只补一次"：一次 pump 可能隔了几小时（休眠/卡顿），
// 补一串会把 IO 打满，而且巩固跑两遍没有意义。

const MIN = 60_000
const DAY = 24 * 60 * MIN

const jobs = new Map()
let timer = null
let lastPumpAt = 0

function ensureTimer() {
  if (timer) return
  timer = setInterval(() => { pump() }, MIN)
  timer.unref?.()
}

/** 每 ms 跑一次 */
function every(name, ms, fn) {
  jobs.set(name, { name, ms, fn, nextAt: Date.now() + ms, fired: 0 })
  ensureTimer()
  return () => jobs.delete(name)
}

/**
 * 每天 hour 点整跑一次（真正的"一天一次"，不是每小时轮询里撞上就算）。
 * opts.now 可以指定"注册时的现在"——测试要用固定时刻，否则
 * 02:xx 注册和 03:xx 注册算出来的首次到期点不同，同一断言会时绿时红。
 */
function dailyAt(name, hour, fn, { now = Date.now() } = {}) {
  jobs.set(name, { name, ms: DAY, fn, atHour: hour, nextAt: nextDaily(hour, now), fired: 0 })
  ensureTimer()
  return () => jobs.delete(name)
}

function nextDaily(hour, now) {
  const d = new Date(now)
  const t = new Date(now)
  t.setHours(hour, 0, 0, 0)
  if (t.getTime() <= d.getTime()) t.setDate(t.getDate() + 1)
  return t.getTime()
}

/** 跑一拍：把所有到期的任务各跑一次。返回实际跑了几件事 */
function pump(now = Date.now()) {
  lastPumpAt = now
  let fired = 0
  for (const j of [...jobs.values()]) {
    if (now < j.nextAt) continue
    j.nextAt = j.atHour == null ? now + j.ms : nextDaily(j.atHour, now)
    j.fired += 1
    fired += 1
    try { j.fn(now) } catch { /* 一个任务失败不能拖累别的 */ }
  }
  return fired
}

function stats() {
  return {
    lastPumpAt,
    jobs: [...jobs.values()].map((j) => ({
      name: j.name,
      everyMs: j.atHour == null ? j.ms : null,
      atHour: j.atHour ?? null,
      fired: j.fired,
      nextInMs: j.nextAt - Date.now(),
    })),
  }
}

function reset() {
  jobs.clear()
  if (timer) { clearInterval(timer); timer = null }
  lastPumpAt = 0
}

export { every, dailyAt, pump, stats, reset, MIN, DAY }
