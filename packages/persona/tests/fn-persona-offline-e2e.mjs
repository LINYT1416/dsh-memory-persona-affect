// 端到端（离线）：整插件挂起来跑几句，验证 注入 / 账本 / 仪表读数 三件事真的串起来了。
// 全程不碰线上进程，也不需要重启。
import fs from 'node:fs'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const home = mkdtempSync(join(tmpdir(), 'persona-e2e-'))
process.env.DSH_HOME = home

const mod = await import('../index.js')
const services = new Map()
let spec = null
mod.apply({
  get: (id) => services.get(id) || null,
  provide: (id, v) => services.set(id, v),
  set: (id, v) => services.set(id, v),
  on: () => () => {},
  effect: () => () => {},
  emit: () => true,
  logger: { info() {}, warn() {}, error() {} },
  systemPrompt: { context: (x) => { spec = x } },
  tools: { register() {} },
  webServer: { register() {} },
})

const fails = []
const ok = (c, m, d = '') => { if (!c) { fails.push(m + ' — ' + d); console.log('FAIL ' + m + (d ? ' — ' + d : '')) } }

const svc = services.get('memory.persona')
ok(Boolean(svc), '没拿到 memory.persona')
if (!svc) process.exit(1)

await new Promise((r) => setTimeout(r, 150))
for (const t of ['在吗', '谢谢你帮我改脚本', '麻烦你了', '谢谢你']) svc.tick([{ type: 'user', text: t }])
await new Promise((r) => setTimeout(r, 40))

const text = spec ? String(spec.text()) : ''
ok(text.length > 0, '注入是空的')
ok(/还欠着他 3 次人情/.test(text), '注入里没有账本那一句', text.slice(0, 200))
ok(!/undefined|NaN/.test(text), '注入里出现 undefined/NaN')

const relFile = join(home, 'persona', 'relation.json')
ok(fs.existsSync(relFile), 'relation.json 没落盘')
if (fs.existsSync(relFile)) {
  const rel = JSON.parse(fs.readFileSync(relFile, 'utf8'))
  ok(rel.debt === 3, 'debt 应该是 3', JSON.stringify(rel))
  ok(Number(rel.turns) >= 4, 'turns 没累加', JSON.stringify(rel))
}


rmSync(home, { recursive: true, force: true })
if (fails.length) process.exit(1)
console.log('PASS 端到端（离线）：注入含账本行、relation.json debt=3 turns 累加、无 undefined')
