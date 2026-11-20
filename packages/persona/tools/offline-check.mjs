// 离线自检：把插件当普通模块跑，不碰线上进程。
//   node tools/offline-check.mjs
// 改完先在这里看注入/账本，确认了再决定是否上线。
import fs from 'node:fs'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const home = mkdtempSync(join(tmpdir(), 'persona-offline-'))
process.env.DSH_HOME = home

const mod = await import('../index.js')
const services = new Map()
let promptSpec = null
const ctx = {
  get: (id) => services.get(id) || null,
  provide: (id, v) => services.set(id, v),
  set: (id, v) => services.set(id, v),
  on: () => () => {},
  effect: () => () => {},
  emit: () => true,
  logger: { info() {}, warn() {}, error() {} },
  systemPrompt: { context: (x) => { promptSpec = x } },
  tools: { register() {} },
  webServer: { register() {} },
}
mod.apply(ctx)

const svc = services.get('memory.persona')
if (!svc) {
  console.log('FAIL 没拿到 memory.persona 服务')
  process.exit(1)
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms))
const say = (t) => svc.tick([{ type: 'user', text: t }])

// 插件启动是异步的（runtime.loaded 在 ready 里才置位），等它一下，否则注入永远是空
await wait(120)
say('在吗')
await wait(30)

say('谢谢你帮我改脚本')
say('麻烦你了')
say('谢谢你')
await wait(30)

const text = promptSpec ? String(promptSpec.text()) : ''
const relFile = join(home, 'persona', 'relation.json')
const relRaw = fs.existsSync(relFile) ? fs.readFileSync(relFile, 'utf8') : ''

console.log('=== 注入（截前 900 字）===')
console.log(text.slice(0, 900))
console.log('')
console.log('=== relation.json ===')
console.log(relRaw || '（没写出来）')
console.log('')

const hasLedgerLine = /还欠着他|欠我|说重了/.test(text)
const hasDebt3 = /"debt":3/.test(relRaw)
console.log('离线自检：' + (hasLedgerLine && hasDebt3
  ? 'PASS（三句人情 → 注入里有账，文件 debt=3）'
  : `FAIL（注入念账=${hasLedgerLine}，文件 debt=3=${hasDebt3}）`))
process.exit(hasLedgerLine && hasDebt3 ? 0 : 1)
