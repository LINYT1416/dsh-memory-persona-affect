// 注入自检：把一段对话跑下来，看注入里有没有"互相打架"的指令。
// 用法：node tools/inject-sanity.mjs
import fs from 'node:fs'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const home = mkdtempSync(join(tmpdir(), 'inj-'))
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
const svc = services.get('memory.persona')
await new Promise((r) => setTimeout(r, 160))

const convo = [
  '在吗',
  '今天好累啊，加班到十点',
  '帮我看看这个报错怎么解决',
  '你行不行啊，这么简单都不会',
  '算了不说了',
  '谢谢你陪我聊',
  '闭嘴吧你烦不烦',
  '我打算明天去把那个脚本改完',
]

// 会互相打架的指令对
const CONFLICTS = [
  ['这条一句就好', '这条可以多说一句'],
  ['这条一句就好', '这条短点，直说'],
  ['这条就一句，别铺', '这条可以多说一句'],
  ['别贫', '可以贫'],
]

let bad = 0
for (const t of convo) {
  svc.tick([{ type: 'user', text: t }], 's')
  await new Promise((r) => setTimeout(r, 25))
  const text = String(spec ? spec.text() : '')
  const lines = text.split('\n').filter((l) => /^- /.test(l))
  const hits = CONFLICTS.filter(([a, b]) => text.includes(a) && text.includes(b))
  const directives = lines.filter((l) => /这条|别闹|别讲道理|别接玩笑|有把握|搞不定|悬着|翻篇|欠着他/.test(l))
  console.log('--- 用户: ' + t)
  console.log('  注入行数: ' + lines.length + '，其中指令/账本句: ' + directives.length)
  if (directives.length) directives.forEach((d) => console.log('   ' + d))
  if (hits.length) {
    bad++
    hits.forEach(([a, b]) => console.log('  ✗ 打架: 「' + a + '」+「' + b + '」'))
  }
  // 指令超过 2 条也算问题：她同一拍不该被同时要求做三件事
  if (directives.length > 2) {
    bad++
    console.log('  ✗ 指令过多：' + directives.length + ' 条')
  }
}

console.log('\n' + (bad ? 'FAIL 有 ' + bad + ' 处注入问题' : 'PASS 注入没有互相打架的指令，也没堆超过 2 条'))
process.exit(bad ? 1 : 0)
