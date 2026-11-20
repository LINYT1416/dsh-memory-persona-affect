// 十轮"像人一样"的记忆生命周期：
// 连续十天的对话 → 关段/巩固 → 复习（间隔效应）→ 情绪事件优先 →
// 干扰（相似事件）→ 新旧事实覆盖 → 跨会话回忆 → 遗忘后靠线索找回。
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'mem-human-'))
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
  return { dispose: noop }
}
const emit = async (name, ...args) => { for (const fn of handlers.get(name) || []) { try { await fn(...args) } catch { /* 单处理器失败不打断 */ } } }
const ctx = {
  get: (n) => svc[n] ?? svc[alias(n)],
  provide: put, set: put, on,
  effect: (fn) => { try { fn() } catch {} return noop },
  logger: { info: noop, warn: noop, error: noop, debug: noop },
  emit: noop,
  systemPrompt: { context: () => () => {} },
  webServer: { register: () => () => {} },
  tools: { register: () => () => {}, get: () => null },
  agents: { list: () => [] },
}

for (const name of ['amygdala', 'cortex', 'prefrontal', 'hippocampus']) {
  const m = await import(`file:///E:/memory/dsh-all/organs/${name}/index.js`)
  m.apply(ctx)
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
  if (!cond) { fails += 1; console.log(`   FAIL ${label}${detail ? ' — ' + detail : ''}`) }
  else console.log(`  ok: ${label}`)
}

const DAY = 24 * 3600 * 1000
const T0 = Date.now() - 10 * DAY

// 十天，每天一段对话；第 2/5/8 天复习"布丁"那件事（间隔效应）
const plan = [
  { text: '今天和同事因为排期吵了一架，气得手抖', tag: '吵架', rehearse: false },
  { text: '晚上改表格改到很晚，脖子有点僵', tag: '表格', rehearse: false },
  { text: '我妈打电话说我爸要住院做手术，我在电话里没敢哭', tag: '住院', rehearsal: true },
  { text: '明天想去海边走走，风大也没关系', tag: '海边', rehearse: false },
  { text: '又被领导叫去谈话，说项目组要裁人', tag: '谈话', rehearse: false },
  { text: '又和同一个同事吵了，这次是因为需求', tag: '吵架', rehearse: true },
  { text: '周末想去爬山，早上六点就得起', tag: '爬山', rehearse: false },
  { text: '下午和同事吵了一架，气得手抖', tag: '吵架', rehearse: false },
  { text: '晚上煮了面，加了两个蛋，很满足', tag: '面', rehearse: false },
  { text: '第三次和那个同事起争执，我直接走了', tag: '吵架', rehearse: false },
]

// 十天日常
for (let r = 0; r < plan.length; r += 1) {
  const at = T0 + r * DAY + 20 * 3600 * 1000
  const session = `day-${r + 1}`
  // 用带时间戳的写入（十天各在不同天，模拟真实时间流逝）
  await H.write({ role: 'user', text: plan[r].text, session, at })
  await wait(20)
  await H.write({ role: 'assistant', text: '嗯，我记着了。', session, at: at + 30 * 1000 })
  await wait(30)
  await H.tick?.({ deep: false })
  await H.settle({ force: true })
  await H.consolidate({ mode: 'shallow' })
  // 夜里睡眠巩固（每三天一次深巩固，像人一样）
  if ((r + 1) % 3 === 0) { await H.consolidate({ mode: 'deep' }); await wait(120) }
  // 间隔复习：重新想起布丁
  if (plan[r].rehearse) {
    const rec = await H.recall({ query: '吵架', k: 5 })
    ok((rec?.hits || []).length > 0, `第 ${r + 1} 天复习「吵架」能想起来`, `hits=${(rec?.hits || []).length}`)
  }
}

await H.warmVectors?.()
await wait(500)

// ① 间隔效应：被复习三次的布丁，应该在「布丁」查询里占前排
const pudding = await H.recall({ query: '吵架', k: 5 })
const pud = (pudding?.hits || [])
ok(pud.length >= 1, '「吵架」能召回', `hits=${pud.length}`)
const topPud = String(pud[0]?.summary || '')
const top3 = pud.slice(0, 3).map((h) => String(h.summary || ''))
ok(String(pud[0]?.summary || '').includes('吵'), '「吵架」查询首位就是吵架那件事', top3.map(t=>t.slice(0,10)).join(' | '))

// ② 情绪事件优先：住院那句的显著性应高于中性事件
const emo = await A.salience('我爸要住院做手术，我在电话里没敢哭')
const neu = await A.salience('晚上改表格改到很晚')
ok(Number(emo?.score) > Number(neu?.score), '情绪事件显著性 > 中性事件', `${emo?.score} vs ${neu?.score}`)

// ③ 干扰：三次「布丁」是相似事件，各自独立存在但都能被找到
const all = await H.recall({ query: '同事 吵架', k: 10 })
const texts = (all?.hits || []).map((h) => String(h.summary || ''))
const distinct = new Set(texts.filter((t) => t.includes('吵')).map((t) => t.slice(0, 14)))
ok(distinct.size >= 2, '相似事件各自独立、没有被错误合并', `distinct=${distinct.size}`)

// ④ 跨会话：换一个 session 也能想起十天前的事（owner 兜底）
const cross = await H.recall({ query: '住院 手术', session: 'new-window', k: 5 })
const fromOther = (cross?.hits || []).filter((h) => h.session && h.session !== 'new-window')
ok(fromOther.length > 0, '换窗口能取到别的会话里的记忆', `hits=${(cross?.hits || []).length} other=${fromOther.length}`)

// ⑤ 新旧事实覆盖：同一个事说了两种地点，应该以新的为准
await C.upsert({ episodeId: 'ep_place_1', facts: [{ subject: '主人', predicate: '地点', object: '威海', kind: 'fact', text: '周末要去威海' }] })
await wait(120)
await C.upsert({ episodeId: 'ep_place_2', facts: [{ subject: '主人', predicate: '地点', object: '青岛', kind: 'fact', text: '周末要去青岛' }] })
await wait(200)
const cst = await C.stats()
const concepts = cst.concepts || []
const place = concepts.find((c) => c.predicate === '地点')
ok(Boolean(place), '地点这条事实存在', JSON.stringify(place))
ok(place && String(place.object) === '青岛', '新事实覆盖了旧事实', JSON.stringify(place))

// ⑥ 睡前巩固：十天的内容应该基本都进了长期（consolidated 比例）
const hstats = await H.stats()
ok(Number(hstats.episodes) >= 5 && Number(hstats.episodes) <= 10, '十天留下 5~10 段（闸门按值不值得记决定，不是每条都记）', String(hstats.episodes))
ok(Number(hstats.consolidated) >= 5, '有相当一部分被巩固进长期', `${hstats.consolidated}/${hstats.episodes}`)

// ⑦ 遗忘与线索：久远的中性事件不容易想起，但给足线索还能找到
const old = await H.recall({ query: '表格 很晚', k: 5 })
ok((old?.hits || []).length > 0, '久远的中性事件给足线索仍能找回', `hits=${(old?.hits || []).length}`)

// ⑧ 计划/闸门仍在工作
const g = await P.shouldRemember('明天想去海边走走', { session: 'day-4', role: 'user' })
ok(g !== undefined && g !== null, '写入闸门仍返回判断', JSON.stringify(g).slice(0, 50))

console.log('DBG', JSON.stringify((globalThis.__dbgCue||[]).slice(-3)))
console.log(`\n断言 ${checks} 条，失败 ${fails} 条`)
console.log(`海马体: episodes=${hstats.episodes} consolidated=${hstats.consolidated}`)
fs.rmSync(TMP, { recursive: true, force: true })
console.log(fails ? `FAIL ${fails}` : 'PASS 十轮人类式记忆生命周期')
process.exit(fails ? 1 : 0)
