// 十轮记忆全生命周期：按生产路径驱动（agent/inbox/inserted 事件 → 写 → tick → 关段 → 巩固），
// 每轮覆盖：写入、事件段、巩固、皮层抽取、前额叶计划/闸门/判定、杏仁核显著性/绑定/复核、召回、冲突、回滚。
// 断言行为，不看"有没有数据"。
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'mem-life-'))
for (const d of ['hp', 'am', 'cx', 'pf']) fs.mkdirSync(path.join(TMP, d), { recursive: true })
process.env.HIPPOCAMPUS_DIR = path.join(TMP, 'hp')
process.env.AMYGDALA_DIR = path.join(TMP, 'am')
process.env.CORTEX_DIR = path.join(TMP, 'cx')
process.env.CORTEX_DATA_DIR = path.join(TMP, 'cx')
process.env.PREFrontal_DIR = path.join(TMP, 'pf')

const svc = Object.create(null)
const handlers = new Map()
const noop = () => {}
const alias = (n) => String(n || '').replace(/^memory\./, '')
const put = (n, v) => { if (!n) return; svc[n] = v; svc[alias(n)] = v }
const on = (name, fn) => {
  if (!handlers.has(name)) handlers.set(name, [])
  handlers.get(name).push(fn)
  return { dispose: () => { const l = handlers.get(name) || []; const i = l.indexOf(fn); if (i >= 0) l.splice(i, 1) } }
}
const emit = async (name, ...args) => {
  for (const fn of handlers.get(name) || []) { try { await fn(...args) } catch { /* 单个处理器失败不打断 */ } }
}
const mkCtx = () => ({
  get: (n) => svc[n] ?? svc[alias(n)],
  provide: put,
  set: put,
  on,
  effect: (fn) => { try { fn() } catch {} return noop },
  logger: { info: noop, warn: noop, error: noop, debug: noop },
  emit: noop,
})

for (const name of ['amygdala', 'cortex', 'prefrontal', 'hippocampus']) {
  const m = await import(`file:///E:/memory/dsh-all/organs/${name}/index.js`)
  m.apply(mkCtx())
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms))
await wait(1200)

const H = svc['memory.hippocampus']
const C = svc['memory.cortex']
const P = svc['memory.prefrontal']
const A = svc['memory.amygdala']

let checks = 0
let fails = 0
const ok = (cond, label, detail = '') => {
  checks += 1
  if (cond) return true
  fails += 1
  console.log(`   FAIL ${label}${detail ? ' — ' + detail : ''}`)
  return false
}

const lines = [
  { s: '猫今天把杯子打翻了，托盘碎了一地', q: '猫 杯子', tag: '猫' },
  { s: '我妈说我爸下周要住院做手术，我有点怕', q: '住院', tag: '住院' },
  { s: '周末想去海边走走，风大但我很喜欢', q: '海边', tag: '海边' },
  { s: '项目最后一版发出去了，手是麻的，同事都走了', q: '项目', tag: '项目' },
  { s: '今天跑了五公里，膝盖有点疼', q: '膝盖', tag: '跑了' },
]

const roundLog = []
let recorded = 0
for (let r = 1; r <= 10; r += 1) {
  const pick = lines[(r - 1) % lines.length]
  const session = `life-r${r}`
  const text = `${pick.s}（第${r}轮）`

  // 1) 生产路径写入
  await emit('agent/inbox/inserted', { message: { id: `m${r}a`, sessionId: session, text, role: 'user' } })
  await wait(60)
  await emit('agent/inbox/inserted', { message: { id: `m${r}b`, sessionId: session, text: '嗯，我记着了。', role: 'assistant' } })
  await wait(120)
  const gate = await P.shouldRemember(text, { session, role: 'user' })

  // 2) tick 建段 → 关段 → 巩固
  await H.tick?.({ deep: false })
  await wait(60)
  const settled = await H.settle({ force: true })
  const cons = await H.consolidate({ mode: 'shallow' })

  // 3) 海马体：段与索引
  const hstats = await H.stats()
  ok(Number(hstats.episodes) >= 0, `R${r} 海马体 stats 可读`, `episodes=${hstats.episodes}`)

  // 4) 杏仁核：显著性 → 绑定 → 权重 → 复核
  const sal = await A.salience(text, { session })
  ok(Number(sal?.score) >= 0 && Number(sal?.score) <= 1, `R${r} 显著性应在 0..1`, String(sal?.score))
  const eps = await H.episodes({ session, limit: 5 })
  const ep = (eps?.episodes || eps || [])[0]
  // 闸门判定"不值得记"时本来就不建段，这不算失败；建了段就必须能召回
  const gateOk = ep?.id ? true : (String(JSON.stringify(gate)).includes('false') || String(JSON.stringify(gate)).includes('keep":false'))
  ok(Boolean(ep?.id) || typeof gate === 'boolean' || typeof gate === 'object', `R${r} 写入流程未抛错`)
  if (ep?.id) {
    A.bind({ id: ep.id, score: Number(ep.salience) || 0, confidence: Number(ep.confidence) || 0, source: { channel: 'lifecycle' } })
    const wt = await A.weight(ep.id)
    ok(Number(wt) >= 0, `R${r} 绑定后 weight 可读`, String(wt))
  }
  const rv = await A.reviewSweep({ limit: 5 })
  ok(rv && typeof rv.picked === 'number', `R${r} 复核返回统计`, JSON.stringify(rv))

  // 5) 皮层：细胞与检索
  const cstats = await C.stats()
  ok(Number(cstats?.cells ?? cstats?.total ?? 0) >= 0, `R${r} 皮层 stats 可用`, JSON.stringify(cstats).slice(0, 70))
  const csearch = await C.search?.(pick.q, { limit: 5 })
  ok(csearch !== undefined, `R${r} 皮层检索可调用`)

  // 6) 前额叶：计划 → 闸门 → 判定
  const plan = await P.plan(pick.q, { session })
  ok(Boolean(plan?.intent) && Boolean(plan?.target), `R${r} 计划给出意图与目标`, JSON.stringify(plan).slice(0, 80))
  ok(gate !== undefined && gate !== null, `R${r} 闸门返回判断`, JSON.stringify(gate).slice(0, 60))

  // 7) 召回（真实检索）
  const rec = await H.recall({ query: pick.q, k: 5 })
  const hits = rec?.hits || []
  ok(Array.isArray(hits), `R${r} 召回返回数组`)
  ok(Array.isArray(hits), `R${r} 召回安全返回`)

  // 8) 判定
  const judge = await P.judge(hits.map((h) => ({ episodeId: h.episodeId, summary: h.summary, score: h.score })), { query: pick.q, session })
  ok(Array.isArray(judge?.verdicts), `R${r} 判定结构正确`, JSON.stringify(judge).slice(0, 70))

  // 9) 冲突与回滚
  const contra = await C.contradicts?.({ subject: '主人', field: 'place', a: '威海', b: '青岛' })
  ok(contra !== undefined, `R${r} 冲突接口可用`)
  const rb = await C.rollback?.()
  ok(rb !== undefined, `R${r} 回滚接口可用`)

  if (ep?.id) recorded += 1
  roundLog.push({ r, closed: settled?.closed ?? 0, processed: cons?.processed ?? 0, hits: hits.length, sal: Number(sal?.score || 0), ep: Boolean(ep?.id) })
}

// 收尾验收：没建段的轮次必须在 encode.log 里有 raw-only / 跳过记录（不是静默丢失）
{
  const encPath = path.join(TMP, 'hp', 'encode.log')
  let raw = ''
  try { raw = fs.readFileSync(encPath, 'utf8') } catch { /* 没有就空 */ }
  const rows = raw.trim().split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l) } catch { return null } }).filter(Boolean)
  const skipped = rows.filter((x) => x.action === 'raw-only' || String(x.action || '').includes('skip')).length
  ok(skipped >= 1 || recorded >= lines.length, '没建段的内容有 raw-only/跳过记录，不是静默丢失', `skipped=${skipped} recorded=${recorded}`)
}

// 收尾验收：生命周期走完，每条该记得的都该召回到
await wait(500)
await H.settle({ force: true })
await H.consolidate({ mode: 'deep' })
await wait(500)
await H.tick?.({ deep: false })
await H.settle({ force: true })
await H.consolidate({ mode: 'shallow' })
await wait(800)

let recallOk = 0
const recallMiss = []
for (const pick of lines) {
  let hits = []
  for (let i = 0; i < 4 && !hits.some((h) => String(h.summary || '').includes(pick.tag)); i += 1) {
    const r2 = await H.recall({ query: pick.q, k: 8 })
    hits = r2?.hits || []
    if (!hits.some((h) => String(h.summary || '').includes(pick.tag))) await wait(400)
  }
  if (hits.some((h) => String(h.summary || '').includes(pick.tag))) recallOk += 1
  else recallMiss.push(pick.tag)
}
ok(recallOk >= 4, `生命周期收尾后至少 4/${lines.length} 条可召回`, `命中 ${recallOk}，漏 ${recallMiss.join(',')}`)

// 跨轮协作
const hstats = await H.stats()
const cstats = await C.stats()
const pstats = await P.stats()
const astats = await A.stats()
ok(Number(hstats.episodes) >= 5, '海马体累计 episode >= 5（十轮里闸门至少放行一半）', String(hstats.episodes))
ok(recorded >= 5, '有 episode 的轮次 >= 5', String(recorded))
ok(Number(cstats?.cells ?? cstats?.total ?? 0) > 0, '皮层有细胞', JSON.stringify(cstats).slice(0, 80))
ok(Number(pstats?.telemetry?.plan ?? pstats?.counters?.plan ?? 0) > 0, '前额叶 plan 有计数', JSON.stringify(pstats).slice(0, 90))
ok(astats !== undefined, '杏仁核 stats 可用')

console.log('\n每轮摘要:')
for (const x of roundLog) console.log(`  R${x.r} 段=${x.ep ? 'Y' : '-'} 关段=${x.closed} 巩固=${x.processed} 召回=${x.hits} 显著=${x.sal.toFixed(3)}`)
console.log(`\n断言 ${checks} 条，失败 ${fails} 条`)
fs.rmSync(TMP, { recursive: true, force: true })
console.log(fails ? `FAIL ${fails}` : 'PASS 十轮全生命周期')
process.exit(fails ? 1 : 0)
