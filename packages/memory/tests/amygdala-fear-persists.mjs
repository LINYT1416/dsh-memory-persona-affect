// 学到的怕，要活过一次重启。
//
// 抓到的 bug：index.js 启动时会从 aversion.jsonl 读回恐惧，但**从来没人写这个文件**。
// 于是"怕中介"只在当前进程里有效，重启就全忘——加载代码写得好好的，数据永远是空的。
// 另外存的行没有 key 字段，就算写了也回填不进 Map。
//
//   node tests/amygdala-fear-persists.mjs
import { mkdtempSync, rmSync, statSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const root = mkdtempSync(join(tmpdir(), 'fearpersist-'))
process.env.DSH_HOME = root
process.env.HIPPOCAMPUS_DIR = join(root, 'hippocampus')
process.env.CORTEX_DIR = join(root, 'cortex')
process.env.AMYGDALA_DIR = join(root, 'amygdala')

const fails = []
const ok = (c, m) => { if (!c) fails.push(m) }

const boot = async (tag) => {
  const services = new Map()
  const ctx = {
    systemPrompt: { context: () => () => {} },
    webServer: { register: () => () => {} },
    tools: { register: () => () => {}, get: () => null },
    agents: { list: () => [] },
    provide: (n, v) => services.set(n, v),
    set: (n, v) => services.set(n, v),
    get: (n) => services.get(n) || null,
    on: () => () => {},
    emit: () => true,
    effect: () => () => {},
    logger: { info() {}, warn() {}, error() {} },
  }
  const { apply } = await import(`../index.js?boot=${tag}`)
  apply(ctx)
  return services.get('memory.amygdala')
}

// 第一次进程：学怕
const a1 = await boot('first')
await a1.observe({ text: '那个中介骗了我，我气死了', session: 's1', at: Date.now() })
const before = a1.caution('中介')
ok(before && Number(before.level) > 0, `第一进程里就没学到：${JSON.stringify(before)}`)

// 落盘要真的写出去（不是只放在内存里）
await new Promise((r) => setTimeout(r, 600))
const file = join(root, 'amygdala', 'aversion.jsonl')
let size = 0
try { size = statSync(file).size } catch { /* 没文件就是没落盘 */ }
ok(size > 0, `aversion.jsonl 没写出来（size=${size}）——重启后学到的怕会全丢`)
if (size > 0) {
  const rows = readFileSync(file, 'utf8').trim().split('\n').filter(Boolean).map((x) => JSON.parse(x))
  ok(rows.some((r) => r.key && r.subject), `落盘的行缺 key/subject，回填会失败：${JSON.stringify(rows[0])}`)
}

// 第二次进程：同一份数据目录，应该记得
const a2 = await boot('second')
await new Promise((r) => setTimeout(r, 900))
const after = a2.caution('中介')
ok(after && Number(after.level) > 0,
  `重启后忘了学到的怕（before=${before?.level} after=${JSON.stringify(after)}）`)
if (after) {
  ok(Math.abs(Number(after.level) - Number(before.level)) < 0.05,
    `重启前后的强度差太多：${before.level} → ${after.level}`)
  ok(String(after.subject) === '中介', `恢复出来的 subject 不对：${after.subject}`)
}

// 没学过的不该凭空出现
ok(a2.caution('房东') === null, `没学过的「房东」不该有怕：${JSON.stringify(a2.caution('房东'))}`)

rmSync(root, { recursive: true, force: true })

if (fails.length) {
  console.log(`FAIL ${fails.length}:`)
  for (const f of fails) console.log(' - ' + f)
  process.exit(1)
}
console.log(`PASS 恐惧落盘（aversion.jsonl ${size}B；重启前后 中介 ${before.level} → ${after.level}，没学过的不出现）`)
process.exit(0)
