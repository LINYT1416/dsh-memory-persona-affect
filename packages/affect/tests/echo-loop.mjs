// 回声闭环：以前有过同样的事 → 心情里出现"这事以前有过"
//
// 这条链路上埋过两个真问题：
//   1. 记忆的检索默认把【情绪】条目排除在外（怕挤掉真实对话），
//      而心情要问的恰恰是"我以前是不是也这样过"——不传 includeEmotion 就永远查不到；
//   2. bridge 同步调 async 的 hip.recall，Promise 被当成空数组。
//
//   node tests/echo-loop.mjs
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const fails = []
const ok = (c, m) => { if (!c) fails.push(m) }

const root = mkdtempSync(join(tmpdir(), 'echo-loop-'))
process.env.DSH_HOME = root
process.env.HIPPOCAMPUS_DIR = join(root, 'hippocampus')

const services = new Map()
const mk = () => {
  const ctx = {
    systemPrompt: { context: () => () => {} },
    webServer: { register: () => () => {} },
    tools: { register: () => () => {}, get: () => null },
    agents: { list: () => [] },
    provide: (n, v) => services.set(n, v),
    set: (n, v) => services.set(n, v),
    get: (n) => (n === 'tools' ? ctx.tools : n === 'webServer' ? ctx.webServer : n === 'agents' ? ctx.agents : services.get(n) || null),
    on: () => () => {},
    emit: () => true,
    effect: () => () => {},
    logger: { info() {}, warn() {}, error() {} },
  }
  return ctx
}

const all = await import('file:///E:/memory/dsh-all/index.js')
all.apply(mk())
const hip = services.get('memory.hippocampus')

const affect = await import('file:///E:/heart/packages/dsh-affect/index.js')
affect.apply(mk())
const core = services.get('affect.core')
ok(Boolean(core), '没拿到 affect.core')

const line = '你行不行啊，这都做不好'

// 先让记忆里确实有"以前也这样"：一条情绪条目
const w = await hip.write({ kind: 'affect', text: `【情绪】委屈：他说${line}`, force: true, valence: -0.45, session: 'echo' })
ok(!w?.skipped, `种子写入失败：${JSON.stringify(w)}`)

// ① 一句同样的话：这一拍就该想起来（同步路）
core.poke(line)
await new Promise((r) => setTimeout(r, 250))
const e1 = core.read().memoryEcho
ok(Boolean(e1?.hits?.length), `第一拍没有回声：${JSON.stringify(e1)}`)
ok(Number(e1?.tone) < 0, `回声色调该是负的，实际 ${e1?.tone}`)

// ② 回声真的进了注入文本，不是只在对象里躺着
const txt = core.text()
ok(/以前/.test(txt), `注入文本里没有"以前"：\n${txt}`)

// ③ 没回想起来时不许编：换一句毫不相干的话，回声必须清空
core.poke('今天地铁好挤啊')
await new Promise((r) => setTimeout(r, 250))
const e2 = core.read().memoryEcho
ok(!e2 || !(e2.hits || []).length, `不相干的话仍有回声（编造记忆）：${JSON.stringify(e2)}`)

// ④ 再换一句不相干的，仍然不许编（回声只属于"这一句"）
core.poke('今天的报表好难改')
await new Promise((r) => setTimeout(r, 250))
const e3 = core.read().memoryEcho
ok(!e3 || !(e3.hits || []).length, `第二句不相干的话仍有回声：${JSON.stringify(e3)}`)

rmSync(root, { recursive: true, force: true })

if (fails.length) {
  console.log(`FAIL ${fails.length}:`)
  for (const f of fails) console.log(' - ' + f)
  process.exit(1)
}
console.log(`PASS 回声闭环（同一句想起 ${e1.hits.length} 条、tone ${e1.tone}、注入含"以前"；不相干的话不编）`)
process.exit(0)
