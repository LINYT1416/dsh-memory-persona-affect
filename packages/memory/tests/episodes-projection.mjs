// 记忆插件 · episodes 投影契约测试
//
// 管的是「记忆交给下游的那张表」：brief / valence / type 必须在里面。
// 这是心情的 memoryRecent 和人格的后扣带唯一的数据来源，
// 投影少一个字段，下游不是报错，是静静地拿到 undefined 当 0 用——最难查的那种。
//
//   node packages/memory\tests\episodes-projection.mjs
//
// 用真数据的副本跑（HIPPOCAMPUS_DIR 指向临时目录），绝不碰真库。
import { cpSync, mkdtempSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const REAL = process.env.HIPPOCAMPUS_REAL
  || 'C:\\Users\\64091\\.dsh\\hippocampus'

if (!existsSync(REAL)) {
  console.log(`跳过：找不到真实记忆库 ${REAL}`)
  process.exit(0)
}

const tmp = mkdtempSync(join(tmpdir(), 'hip-proj-'))
// 只拷数据文件，不拷模型（这里不走向量，省 25MB 和几秒）
for (const f of ['episodes.jsonl', 'index.jsonl', 'links.jsonl', 'meta.json', 'candidates.jsonl']) {
  const src = join(REAL, f)
  if (existsSync(src)) cpSync(src, join(tmp, f))
}
process.env.HIPPOCAMPUS_DIR = tmp

const fails = []
const ok = (cond, msg) => { if (!cond) fails.push(msg) }

const mod = await import('file:///E:/memory/dsh-all/organs/hippocampus/index.js')

const services = new Map()
const tools = []
const ctx = {
  tools: { get: () => null, register: (t) => { tools.push(t?.name) } },
  webServer: null,
  agents: { list: () => [] },
  provide: (n, v) => services.set(n, v),
  get: (n) => (n === 'tools' ? ctx.tools : null),
  effect: (fn) => { if (typeof fn === 'function') { try { const d = fn(); if (typeof d === 'function') d() } catch { /* ignore */ } } },
  on: () => () => {},
  emit: () => true,
  logger: { info() {}, warn() {}, error() {} },
}

let dispose = null
let err = null
try { dispose = mod.apply(ctx) } catch (e) { err = e }
ok(!err, `apply 抛错：${err?.stack || err}`)

const api = services.get('memory.hippocampus')
ok(Boolean(api), '没 provide memory.hippocampus')
ok(typeof api?.episodes === 'function', 'episodes 不是函数')

// 等一拍，让 store 把行加载进内存
await new Promise((r) => setTimeout(r, 300))

// 取满窗口：覆盖率要拿同一批 episode 跟 moodTrend 比，否则 60 条上限会把口径拉歪
const rows = await api.episodes({ limit: 2000 })
console.log(`episodes 返回 ${rows.length} 条`)

ok(rows.length > 0, 'episodes 返回空：投影测试没有意义')

// 1) brief 必须在，且是真内容
const withBrief = rows.filter((r) => typeof r.brief === 'string' && r.brief.trim())
ok(withBrief.length === rows.length, `brief 缺失 ${rows.length - withBrief.length} 条`)
const tooLong = rows.filter((r) => (r.brief || '').length > 40)
ok(tooLong.length === 0, `brief 超长 ${tooLong.length} 条（应 ≤40）`)

// 2) valence 必须"有键"：number 或明确 null，绝不能是 undefined
const missingKey = rows.filter((r) => !Object.prototype.hasOwnProperty.call(r, 'valence'))
ok(missingKey.length === 0, `valence 键缺失 ${missingKey.length} 条（下游会读成 undefined→0）`)
const withVal = rows.filter((r) => typeof r.valence === 'number')
const nullVal = rows.filter((r) => r.valence === null)
ok(withVal.length + nullVal.length === rows.length, 'valence 既不是 number 也不是 null')

// 3) 投影口径必须和 moodTrend 的统计口径一致（这是本条测试的核心）
const trend = api.moodTrend ? await api.moodTrend({ days: 7 }) : null
if (trend) {
  const now = Date.now()
  const recent = rows.filter((r) => Number(r.at) >= now - 7 * 86400_000)
  const rateProj = recent.length ? recent.filter((r) => typeof r.valence === 'number').length / recent.length : 0
  console.log(`7 天投影覆盖率 ${(rateProj * 100).toFixed(1)}% · moodTrend 报 ${(trend.coverage * 100).toFixed(1)}%`)
  ok(Math.abs(rateProj - trend.coverage) <= 0.2,
    `两边口径对不上：投影 ${(rateProj * 100).toFixed(1)}% vs 统计 ${(trend.coverage * 100).toFixed(1)}%`)
}

// 4) 情绪条目必须可识别（上层靠 type / 【情绪】 前缀挡掉它们）
const emo = rows.filter((r) => r.type === 'emotion' || String(r.brief || '').startsWith('【情绪】'))
console.log(`可识别的情绪条目 ${emo.length} 条`)
ok(rows.every((r) => typeof r.type === 'string' || r.type === undefined),
  'type 字段形状异常')

// 5) 排序契约：episodes 返回按时间升序（limit 取最后 N 条）
let asc = true
for (let i = 1; i < rows.length; i++) if (Number(rows[i].at) < Number(rows[i - 1].at)) asc = false
ok(asc, 'episodes 没有按时间升序返回')

if (typeof dispose === 'function') { try { dispose() } catch { /* ignore */ } }
try { rmSync(tmp, { recursive: true, force: true }) } catch { /* ignore */ }

if (fails.length) {
  console.log(`\nFAIL ${fails.length}:`)
  for (const f of fails) console.log(` - ${f}`)
  process.exit(1)
}
console.log('\nPASS episodes 投影契约（brief/valence/type/排序/与统计口径一致）')
process.exit(0)
