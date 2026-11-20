// 工作记忆是"按会话分档"的。以前 stats 写死 hot.tiers('default')，
// 数据却挂在真实 session 下，于是永远显示"空的"——这是报告 bug，不是没工作。
import { readFileSync } from 'node:fs'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const TMP = mkdtempSync(join(tmpdir(), 'pf-hot-'))
process.env.PREFrontal_DIR = TMP

const hot = await import('file:///E:/memory/dsh-all/organs/prefrontal/store/hot.js')

let fail = 0
const ok = (c, m) => { if (!c) { fail++; console.log('FAIL', m) } else { console.log('  ok:', m) } }

await hot.refresh('session-A', [
  { id: 'e1', episodeId: 'e1', summary: '主人说想去看海', at: Date.now(), score: 0.9 },
  { id: 'e2', episodeId: 'e2', summary: '主人今天加班到十点', at: Date.now() - 86400000, score: 0.4 },
])
await hot.refresh('session-B', [
  { id: 'e3', episodeId: 'e3', summary: '另一个会话的记忆', at: Date.now(), score: 0.7 },
])

const ids = hot.sessionIds()
ok(ids.includes('session-A') && ids.includes('session-B'), `要能列出真实会话（实际 ${ids.join(',')}）`)
ok(!ids.includes('default'), '不应该冒出一个 default 空会话')
const latest = hot.latestSession()
ok(latest === 'session-A' || latest === 'session-B', `要有最近会话（实际 ${latest}）`)
ok(hot.tiers('session-A').hot.length >= 1, 'session-A 的 hot 档应有内容')

const src = readFileSync('E:/memory/dsh-all/organs/prefrontal/index.js', 'utf8')
ok(!/hot:\s*hot\.tiers\('default'\)/.test(src), 'stats 不许再写死 default')
ok(/hot\.latestSession\(\)/.test(src), 'stats 要用 latestSession()')

rmSync(TMP, { recursive: true, force: true })
console.log(fail ? `FAIL ${fail}` : 'PASS 工作记忆按会话报告（列出真实会话 / 有最近会话 / 不写死 default）')
process.exit(fail ? 1 : 0)
