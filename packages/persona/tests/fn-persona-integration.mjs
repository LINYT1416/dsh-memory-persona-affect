// 端到端：把十几条线路全接上之后，注入还读得通吗（不许打架、不许堆成清单）
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const fails = []
const ok = (c, m, d = '') => { if (!c) { fails.push(m + ' — ' + d); console.log('FAIL ' + m + (d ? ' — ' + d : '')) } }

const home = mkdtempSync(join(tmpdir(), 'integ-'))
process.env.DSH_HOME = home

const mod = await import('../index.js?integ')
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
ok(Boolean(svc), '服务没起来', '')
await new Promise((r) => setTimeout(r, 200))

const convo = [
  '在吗',
  '今天好累啊，加班到十点',
  '帮我看下这个报错怎么解决',
  '你行不行啊，这么简单都不会',
  '这件事我打算明天做完',
  '你怎么了',
  '你是不是怕失败',
  '我朋友人挺好的，还特别厉害',
  '谢谢你陪我聊',
  '算了不说了',
  '我为什么一直想学吉他',
  '晚安',
]

const CONFLICTS = [
  ['一条一句', '可以多说一句'],
  ['还能撑', '撑不住'],
  ['不在乎', '很难过'],
  ['先去忙', '别走'],
]

let maxLines = 0
let directiveMax = 0
for (const t of convo) {
  svc.tick([{ type: 'user', text: t }], 'sess')
  await new Promise((r) => setTimeout(r, 20))
  const text = String(spec ? spec.text() : '')
  const lines = text.split('\n').filter((l) => /^- /.test(l))
  maxLines = Math.max(maxLines, lines.length)
  const directives = lines.filter((l) => /这条|别闹|别讲道理|别接玩笑|有把握|搞不定|翻篇|忍住|去做|说不上来/.test(l))
  directiveMax = Math.max(directiveMax, directives.length)
  for (const [a, b] of CONFLICTS) {
    if (text.includes(a) && text.includes(b)) {
      fails.push(`打架：「${a}」+「${b}」 出现在「${t}」`)
      console.log(`FAIL 打架：「${a}」+「${b}」`)
    }
  }
}

// 注入没被堆成清单
ok(maxLines <= 20, '注入行数过多（超过 20 行）', String(maxLines))
// 同一拍里行为指令不该超过 3 条
ok(directiveMax <= 3, '同一拍指令太多', String(directiveMax))

// 最后一条是晚安：仪式/角色之类不该把它淹了
const last = String(spec ? spec.text() : '')
ok(last.length > 0, '最后注入是空的', '')

if (fails.length) process.exit(1)
console.log(`PASS 端到端（12 轮对话，最多 ${maxLines} 行注入，最多 ${directiveMax} 条指令，无互相矛盾）`)
