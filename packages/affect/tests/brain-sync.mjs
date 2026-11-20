// 同拍召回（recallSync）+ 心境一致性重排 的验证。
// 用记忆侧接口文档里的真实返回形状：degraded=true、valenceReady=false、valence=null。
//   node tests/brain-sync.mjs
import { createBridge } from '../core/bridge.js'
import { createEngine } from '../core/engine.js'

const fails = []
const ok = (c, m) => { if (!c) fails.push(m) }

const mkHits = () => ([
  { id: 'e-neg', brief: '上次插件跑通了又崩了', valence: null, salience: 0.5, at: 1, score: 0.5, why: 'bm25' },
  { id: 'e-pos', brief: '那天一起看完了电影', valence: null, salience: 0.5, at: 2, score: 0.5, why: 'bm25' },
])

const fakeHip = {
  recallSync: (text, opts) => {
    ok(typeof text === 'string', 'recallSync 要收到文本')
    ok(typeof opts?.valence === 'number', 'recallSync 要收到心情效价')
    ok(typeof opts?.beforeMs === 'number', 'recallSync 要收到 beforeMs（写读先后）')
    return {
      ok: true, degraded: true, valenceReady: false,
      hits: mkHits(), ms: 7, source: 'recallSync',
    }
  },
  write: () => null,
}

const bridge = createBridge((id) => (id === 'memory.hippocampus' ? fakeHip : null))

// 1. 同拍：不再隔一拍
const clock = new Date('2026-11-12T21:00:00+08:00').getTime()
const eng = createEngine({ now: () => clock, bridge })
eng.tick([{ type: 'user', text: '插件又崩了', at: clock }])
const echo = eng.read().memoryEcho
ok(echo && echo.hits.length, '同一拍就应该有回声，不能等下一拍')
ok(echo?.degraded === true, 'degraded 要透传（当前版本恒为 true）')
ok(echo?.valenceReady === false, 'valenceReady 要透传（历史条目没有 valence）')

// 2. valenceReady=false 时靠账本 join，仍能做心境一致性
const ledger = new Map([['e-neg', -0.8], ['e-pos', 0.7]])
const low = bridge.moodRerank(mkHits(), -0.6, { degraded: true, ledger })
ok(low[0].id === 'e-neg', `低落时先想起糟心事，实际 ${low[0]?.id}`)
const high = bridge.moodRerank(mkHits(), 0.6, { degraded: true, ledger })
ok(high[0].id === 'e-pos', `开心时先想起好事，实际 ${high[0]?.id}`)

// 3. 降级权重是 0.075（与记忆侧公式一致）
const na = bridge.moodRerank([{ id: 'x', brief: 'x', valence: null, salience: 0 }], -1, { degraded: true, ledger: new Map([['x', -1]]) })[0]
ok(Math.abs(na.score - 0.075) < 1e-9, `降级权重应为 0.075，实际 ${na.score}`)
const na2 = bridge.moodRerank([{ id: 'x', brief: 'x', valence: null, salience: 0 }], -1, { degraded: false, ledger: new Map([['x', -1]]) })[0]
ok(Math.abs(na2.score - 0.15) < 1e-9, `不降级权重应为 0.15，实际 ${na2.score}`)

// 4. 记忆侧给了 valence 时，以它为准（不被账本覆盖）
const withVal = bridge.moodRerank([{ id: 'e-neg', brief: 'x', valence: -0.9, salience: 0 }], -1, { degraded: false, ledger })
ok(Math.abs(withVal[0].valence + 0.9) < 1e-9, '记忆侧的 valence 优先于账本')

// 5. ok:false（索引没进内存）→ 退回异步，不许当成想不起来
const notReady = createBridge((id) => (id === 'memory.hippocampus'
  ? { recallSync: () => ({ ok: false, degraded: true, reason: 'index-not-loaded', hits: [] }), recall: async () => [{ summary: '旧记忆', valence: 0 }] }
  : null))
let c2 = new Date('2026-11-12T21:00:00+08:00').getTime()
const e2 = createEngine({ now: () => c2, bridge: notReady })
e2.tick([{ type: 'user', text: '插件又崩了', at: c2 }])
ok(e2.read().memoryEcho === null, 'ok:false 时同拍不该硬给回声')
await new Promise(r => setTimeout(r, 10))
e2.state.at = c2 + 60_000
e2.tick([])
ok(e2.read().memoryEcho?.hits?.length, '退回异步后第二拍要能补上')

// 6. 回归：这一句想不起来时，不许把上一句的回声挂上来（那比没有更糟）
{
  let n = 0
  const hip2 = {
    recallSync: (text) => {
      n += 1
      const hit = n === 1 ? [{ id: 'e1', brief: '上一句想起来的事', valence: -0.4, salience: 0.5 }] : []
      return { ok: true, degraded: true, valenceReady: false, hits: hit, ms: 7, source: 'recallSync' }
    },
    write: () => null,
  }
  const b2 = createBridge((id) => (id === 'memory.hippocampus' ? hip2 : null))
  let t = new Date('2026-11-12T22:00:00+08:00').getTime()
  const e3 = createEngine({ now: () => t, bridge: b2 })
  e3.tick([{ type: 'user', text: '心情插件目前的原理是什么', at: t }])
  ok(e3.read().memoryEcho?.hits?.length === 1, '有内容的那句应同拍拿到回声')
  t += 60_000
  e3.tick([{ type: 'user', text: '重启完了', at: t }])
  ok(e3.read().memoryEcho === null, '这一句没想起什么时，回声必须为空，不能沿用上一句的')
}

console.log(fails.length ? `FAIL ${fails.length}:\n- ${fails.join('\n- ')}` : 'PASS 同拍召回、账本 join、0.075/0.15 权重、ok:false 回退、跨句不串回声 全部通过')
process.exit(fails.length ? 1 : 0)
