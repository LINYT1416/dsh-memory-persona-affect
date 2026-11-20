// 影子日志落盘自检：必须写进数据目录，不能依赖进程 CWD。
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const TMP = mkdtempSync(join(tmpdir(), 'hippo-shadow-'))
process.env.DSH_HIPPO_DIR = TMP
process.env.CORTEX_DIR = join(TMP, 'cortex')

// store.js 用 DSH_HIPPO_DIR？先看它怎么定 DATA_DIR，再决定注入哪个变量
const storeSrc = readFileSync(new URL('../organs/hippocampus/lib/store.js', import.meta.url), 'utf8')
const m = /process\.env\.(\w+)\s*\|\|/.exec(storeSrc.split('\n').slice(0, 20).join('\n'))
const envName = m ? m[1] : null
if (envName && envName !== 'DSH_HIPPO_DIR') process.env[envName] = TMP

const { FILES, resolveFile } = await import('../organs/hippocampus/lib/store.js')
const { logShadow } = await import('../organs/hippocampus/lib/shadow.js')

let fail = 0
const ok = (c, m) => { if (!c) { fail++; console.log('FAIL', m) } else { console.log('  ok:', m) } }

ok(!!FILES.shadow, 'FILES.shadow 应存在')
ok(FILES.shadow.startsWith(TMP), `FILES.shadow 应落在数据目录（实际 ${FILES.shadow}）`)
ok(resolveFile('shadow.log') === join(TMP, 'shadow.log'), '裸文件名应解析到数据目录')
ok(resolveFile(FILES.shadow) === FILES.shadow, '绝对路径应原样返回')

await logShadow({ at: Date.now(), hash: 'h1', text: '测试', current: 'distinct', shadow: 'same', score: 0.7 })
ok(existsSync(FILES.shadow), `shadow.log 应真的写出来（${FILES.shadow}）`)
const lines = readFileSync(FILES.shadow, 'utf8').split('\n').filter(Boolean)
ok(lines.length === 1, `应有 1 条（实际 ${lines.length}）`)
ok(JSON.parse(lines[0]).shadow === 'same', '内容应是刚才那条')

rmSync(TMP, { recursive: true, force: true })
console.log(fail ? `FAIL ${fail}` : 'PASS 影子日志（写入数据目录 / 裸名兜底 / 内容正确）')
process.exit(fail ? 1 : 0)
