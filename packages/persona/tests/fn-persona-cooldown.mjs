// 冷却：同一个状态连着问五遍，同类话只能说一次
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const fails = []
const ok = (c, m, d = '') => { if (!c) { fails.push(m + ' — ' + d); console.log('FAIL ' + m + (d ? ' — ' + d : '')) } }

const home = mkdtempSync(join(tmpdir(), 'cool-'))
process.env.DSH_HOME = home

const mod = await import('../index.js?cool')
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
const svc = services.get('memory.persona')
await new Promise((r) => setTimeout(r, 200))

// 记下每一拍里出现的"行为句"
const seen = []
for (let i = 0; i < 5; i++) {
  svc.tick([{ type: 'user', text: '在吗' }], 'cool')
  await new Promise((r) => setTimeout(r, 20))
  const text = String(spec ? spec.text() : '')
  const lines = text.split('\n').filter((l) => /^- /.test(l))
  seen.push(lines)
}

// 五拍里，任何一句行为话最多出现一次
// 只查行为句：固定的口气例句每拍都带，本来就该重复
const BEHAVE = /这条|别闹|别讲道理|有把握|搞不定|改主意|说不上来|撑不住|还没完全过去|没聊过|一起做|忍不住|去吧|别答应/
const flat = seen.flat().filter((l) => BEHAVE.test(l))
const dup = {}
for (const l of flat) dup[l] = (dup[l] || 0) + 1
const repeated = Object.entries(dup).filter(([, n]) => n > 1)
ok(repeated.length === 0, '有行为句被重复念了', JSON.stringify(repeated.slice(0, 3)))

// 至少有一拍是有内容的（不是全空）
ok(seen[0].length > 0, '第一拍就没有任何注入', '')

if (fails.length) process.exit(1)
console.log(`PASS 冷却（5 拍相同输入，没有一句被重复念；每拍行数 ${seen.map((x) => x.length).join('/')}）`)
