// 端到端：POST /persona/save 切模式，注入真的跟着变（不是只改了配置文件）
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const fails = []
const ok = (c, m, d = '') => { if (!c) { fails.push(m + ' — ' + d); console.log('FAIL ' + m + (d ? ' — ' + d : '')) } }

const home = mkdtempSync(join(tmpdir(), 'mode-e2e-'))
process.env.DSH_HOME = home
mkdirSync(join(home, 'persona'), { recursive: true })
writeFileSync(join(home, 'persona', 'panel.json'), JSON.stringify({ mode: 'custom', selfText: '', injectMax: 8 }), 'utf8')

const mod = await import('../index.js?mode-e2e')
const routes = new Map()
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
  webServer: { register: ({ method, path, handler }) => routes.set(`${method} ${path}`, handler) },
})
const svc = services.get('memory.persona')
await new Promise((r) => setTimeout(r, 200))

const save = routes.get('POST /persona/save')
ok(Boolean(save), '没注册 POST /persona/save', [...routes.keys()].join(','))

const fakeReq = (obj) => {
  const listeners = {}
  const req = {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    on(ev, cb) { (listeners[ev] = listeners[ev] || []).push(cb); return req },
  }
  setTimeout(() => {
    ;(listeners.data || []).forEach((cb) => cb(Buffer.from(JSON.stringify(obj))))
    ;(listeners.end || []).forEach((cb) => cb())
  }, 5)
  return req
}
const callSave = (obj) => new Promise((resolve) => {
  const res = { setHeader() {}, end(b) { resolve(String(b || '')) }, writeHead() {} }
  save(fakeReq(obj), res)
})

const SELF = '她叫小鱼，说话短，爱答不理那种酷'
await callSave({ mode: 'custom', selfText: SELF })

const say = async (t) => { svc.tick([{ type: 'user', text: t }], 'm'); await new Promise((r) => setTimeout(r, 30)); return String(spec.text()) }

const inCustom = await say('在吗')
ok(inCustom.includes('她自己认的样子'), '自定义模式该带自述', inCustom.slice(0, 120))
ok(inCustom.includes('她叫小鱼'), '自述内容没进去', '')

await callSave({ mode: 'learn', selfText: SELF })
const inLearn = await say('在吗')
ok(!inLearn.includes('她自己认的样子'), '纯学习模式不该带自述', inLearn.slice(0, 120))
ok(!inLearn.includes('她叫小鱼'), '纯学习模式自述漏进去了', '')

// 切回去还能恢复
await callSave({ mode: 'custom', selfText: SELF })
const back = await say('在吗')
ok(back.includes('她叫小鱼'), '切回自定义没恢复自述', back.slice(0, 120))

if (fails.length) process.exit(1)
console.log('PASS 模式切换端到端（custom 带自述 / learn 不带 / 切回来恢复）')
