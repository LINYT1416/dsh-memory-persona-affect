// 端到端：把 /persona/state 这个路由真的调一次，看返回里有没有全部 25 个字段。
// 这条对应"部署后仪表页会不会还是占位"——不能只靠单元测试猜。
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const fails = []
const ok = (c, m, d = '') => { if (!c) { fails.push(m + ' — ' + d); console.log('FAIL ' + m + (d ? ' — ' + d : '')) } }

const home = mkdtempSync(join(tmpdir(), 'state-e2e-'))
process.env.DSH_HOME = home
mkdirSync(join(home, 'persona'), { recursive: true })
writeFileSync(join(home, 'persona', 'identity.json'), JSON.stringify({ name: '大肥鱼', job: '软件研发' }), 'utf8')
writeFileSync(join(home, 'persona', 'storyline.json'), JSON.stringify({ oneLine: '我在过日子' }), 'utf8')
writeFileSync(join(home, 'persona', 'interlocutor.json'), JSON.stringify({ name: '示例用户' }), 'utf8')

const mod = await import('../index.js?state-e2e')
const routes = new Map()
const services = new Map()
mod.apply({
  get: (id) => services.get(id) || null,
  provide: (id, v) => services.set(id, v),
  set: (id, v) => services.set(id, v),
  on: () => () => {},
  effect: () => () => {},
  emit: () => true,
  logger: { info() {}, warn() {}, error() {} },
  systemPrompt: { context: () => {} },
  tools: { register() {} },
  webServer: { register: ({ method, path, handler }) => routes.set(`${method} ${path}`, handler) },
})
await new Promise((r) => setTimeout(r, 200))

const handler = routes.get('GET /persona/state')
ok(Boolean(handler), '没注册 /persona/state 路由', [...routes.keys()].join(','))

// 假 res：把 JSON 收回来
const captured = await new Promise((resolve) => {
  const res = {
    statusCode: 200,
    setHeader() {},
    end(body) { resolve(String(body || '')) },
    writeHead() {},
  }
  handler({ method: 'GET', url: '/persona/state', headers: {} }, res)
})
let state = {}
try { state = JSON.parse(captured) } catch { state = {} }

const REQUIRED = [
  'mode', 'injectMax', 'style', 'looks', 'coverage', 'organs',
  'relation', 'goals', 'conflicts', 'possess', 'crave',
  'worth', 'habit', 'keyPeriod', 'consistency', 'identity',
  'speakers', 'storyline', 'interlocutor', 'ritual', 'reciprocity', 'majorEvent', 'ostracism', 'boundary', 'repair',
]
const missing = REQUIRED.filter((k) => state[k] === undefined)
ok(missing.length === 0, '/persona/state 缺字段', missing.join(', '))
ok(state.identity && state.identity.filled === true, 'identity 没读到真实文件', JSON.stringify(state.identity))
ok(state.interlocutor && state.interlocutor.name === '示例用户', 'interlocutor 名字不对', JSON.stringify(state.interlocutor))
ok(state.storyline && state.storyline.filled === true, 'storyline 没读到', JSON.stringify(state.storyline))
ok(state.ritual && typeof state.ritual === 'object', 'ritual 不是对象', JSON.stringify(state.ritual))
ok(state.consistency && typeof state.consistency === 'object', 'consistency 不是对象', JSON.stringify(state.consistency))
ok(state.speakers && typeof state.speakers === 'object', 'speakers 不是对象', JSON.stringify(state.speakers))

console.log('字段数：' + Object.keys(state).length)
if (fails.length) process.exit(1)
console.log('PASS /persona/state 端到端（25 个字段齐、identity/interlocutor/storyline 读到真实数据）')
