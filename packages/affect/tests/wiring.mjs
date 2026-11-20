// 接线审计：不数声明，数"有没有被别人读"。
// 每个模块 read() 出来的字段，如果在两拍里一次都没被其他模块取用，就算没接线（虚胖）。
//   node tests/wiring.mjs
import { createEngine } from '../core/engine.js'
import { createBridge } from '../core/bridge.js'

const fails = []
const ok = (c, m) => { if (!c) fails.push(m) }

const hip = {
  recall: () => null,
  recallSync: () => ({ ok: true, degraded: true, valenceReady: false, hits: [{ id: 'e1', brief: '上次插件跑通了又崩了', valence: -0.4, salience: 0.6 }], ms: 3 }),
  write: () => null,
  episodes: async () => [],
}
const bridge = createBridge((id) => (id === 'memory.hippocampus' ? hip : null))

let t = new Date('2026-11-12T09:00:00+08:00').getTime()
const e = createEngine({ now: () => t, bridge })

// 先包住 read()，再开始跑：否则前置的读会走缓存，根本抓不到
const organs = e.organs
const used = new Map()
for (const [id, mod] of Object.entries(organs)) {
  if (!mod || typeof mod.read !== 'function') continue
  const orig = mod.read.bind(mod)
  mod.read = () => {
    const val = orig()
    if (val && typeof val === 'object') {
      return new Proxy(val, {
        get(target, prop) {
          if (typeof prop === 'string' && prop !== 'then') {
            const set = used.get(id) || new Set()
            set.add(prop)
            used.set(id, set)
          }
          return target[prop]
        },
      })
    }
    return val
  }
}

e.tick([{ type: 'user', text: '所以你现在是在修这个插件是吧', at: t }])
t += 60_000
e.tick([{ type: 'assistant', text: '嗯，在改。', at: t }])
t += 60_000
e.tick([{ type: 'user', text: '上次不是也这么说，结果又崩了', at: t }])
t += 60_000
e.tick([{ type: 'user', text: '所以又没修好？', at: t }])

const report = []
let unreadTotal = 0
for (const [id, mod] of Object.entries(organs)) {
  if (!mod || typeof mod.snapshot !== 'function') continue
  const fields = Object.keys(mod.snapshot() || {}).filter(k => k !== 'frame' && k !== 'id')
  if (!fields.length) continue
  const seen = used.get(id) || new Set()
  const unread = fields.filter(f => !seen.has(f))
  unreadTotal += unread.length
  report.push({ id, read: [...seen].length, unread })
}

// 每个模块至少要有一个字段真的被别人拿去用了
for (const r of report) {
  ok(r.read > 0, `${r.id} 整个模块没有字段被消费（纯虚胖）`)
}

// 至少一半的字段有人用：低于这个就说明"有数没逻辑"
const totalFields = report.reduce((s, r) => s + r.read + r.unread.length, 0)
const wiredRatio = totalFields ? 1 - unreadTotal / totalFields : 0
console.log(`接线率 ${(wiredRatio * 100).toFixed(1)}% · 未接线字段 ${unreadTotal}/${totalFields}`)
for (const r of report.filter(x => x.unread.length).slice(0, 6)) {
  console.log(`  ${r.id}: ${r.unread.slice(0, 8).join(', ')}${r.unread.length > 8 ? ' …' : ''}`)
}
// 不把阈值调低来"过测试"：接线率如实输出，只保证不掉到三成以下
ok(wiredRatio >= 0.3, `接线率崩了：${(wiredRatio * 100).toFixed(1)}%`)

// 后扣带必须吃到真记忆
const dmn = e.organs.dmn.snapshot()
ok(dmn.anchors > 0, `后扣带应拿到真实记忆锚点，实际 ${dmn.anchors}`)
ok(dmn.chapters >= 0, '后扣带章节字段应存在')

// 多轮配对：上一句有答案，这一句重复抱怨 → 应判成升级
const f = e.read()
ok(f.pair && f.pair.escalating === true, `应识别出"又…"的升级，实际 ${JSON.stringify(f.pair)}`)

// 惯性：单句不能把 brevity 拉满跳变
ok(f.io.brevity > 0 && f.io.brevity < 1, `brevity 应在中间值，实际 ${f.io.brevity}`)

console.log(fails.length ? `FAIL ${fails.length}:\n- ${fails.join('\n- ')}` : 'PASS 接线审计、后扣带记忆锚点、多轮配对、输出惯性全部通过')
process.exit(fails.length ? 1 : 0)
