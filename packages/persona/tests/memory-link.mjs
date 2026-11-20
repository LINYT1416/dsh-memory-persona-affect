// 人格插件 · 记忆接缝测试
//
// 管的是"人格到底能不能想起事"。以前它调 recall('')，空串在记忆侧直接返回空数组，
// 所以缓存永远是 0，后扣带的 anchors/nostalgia 全是 0——测试全绿，功能全空。
//
//   node tests/memory-link.mjs
import { createMemoryBridge } from '../bridge/memory.js'
import { createEngine } from '../core/engine.js'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// 隔离：不读宿主真实记忆，否则"没接上"这一条永远测不到（磁盘退路会读到真数据）
process.env.HIPPOCAMPUS_DIR = mkdtempSync(join(tmpdir(), 'memlink-'))

const fails = []
const ok = (c, m) => { if (!c) fails.push(m) }

const now = Date.now()
function fakeHip(rows) {
  const calls = []
  return {
    calls,
    episodes: async (opts = {}) => {
      calls.push(opts)
      return rows.slice(-(opts.limit || 50))
    },
    // 故意留一个能"成功"的 recall：如果代码还在用空串检索，
    // 这条会被调用并且返回空 hits —— 于是测试会失败，而不是悄悄通过
    recall: async (q) => {
      calls.push({ recall: q })
      return { hits: q ? [{ id: 'x', brief: '真检索', valence: 0.1 }] : [] }
    },
  }
}

const ROWS = [
  { id: 'a', brief: '【情绪】委屈：被顶了一下', type: 'emotion', valence: -0.4, at: now - 1000 },
  { id: 'b', brief: '在客厅把 recallSync 改完了', type: 'scene', valence: -0.2, at: now - 2000 },
  { id: 'c', brief: '插件又崩了，烦死我了', type: 'event', valence: -0.5, at: now - 3000 },
  { id: 'd', brief: '今天把接口重写了一遍', type: 'event', valence: null, at: now - 4000 },
  { id: 'e', brief: '【情绪】有情绪：', type: 'emotion', valence: 0, at: now - 5000 },
]

// ── 1. refresh：拿得到、挡得住、null 保住 ─────────────────
{
  const hip = fakeHip(ROWS)
  const bridge = createMemoryBridge((id) => (id === 'memory.hippocampus' ? hip : null))
  const r = await bridge.refresh(6)
  ok(r.ok === true, `refresh 应成功，实际 ${JSON.stringify(r)}`)
  const eps = bridge.episodes()
  ok(eps.length === 3, `应剩 3 条真记忆，实际 ${eps.length}：${eps.map((x) => x.brief).join(' / ')}`)
  ok(!eps.some((x) => String(x.brief).startsWith('【情绪】')), '【情绪】没挡住')
  ok(!hip.calls.some((c) => c.recall === ''), '不该再拿空串去检索')
  const d = await bridge.episodes().find((x) => x.brief === '今天把接口重写了一遍')
  ok(d && d.valence === null, `缺效价要 null，实际 ${JSON.stringify(d)}`)
}

// ── 2. 没有记忆器官：不许伪造 ─────────────────────────────
{
  const bridge = createMemoryBridge(() => null)
  const r = await bridge.refresh(6)
  ok(r.ok === false, '没有 hippocampus 时 refresh 应 ok:false')
  ok(bridge.episodes().length === 0, '没接上就是空数组，不伪造')
  ok(bridge.status().hippocampus === false, 'status 要如实说没接上')
}

// ── 3. 端到端：记忆接上以后，后扣带的 anchors 真的长出来 ──
{
  const hip = fakeHip(ROWS)
  const memory = createMemoryBridge((id) => (id === 'memory.hippocampus' ? hip : null))
  await memory.refresh(6)

  const engine = createEngine({
    bridge: {
      affect: () => ({ mood: 0, valence: -0.2, arousal: 0.4, trust: 0.6, kind: '委屈' }),
      episodes: () => memory.episodes(),
    },
  })

  const before = engine.organs.pcc.read()
  ok(before.anchorCount === 0, `初始不该有锚点，实际 ${before.anchorCount}`)

  // 走三拍：后扣带要吃进 episodes 才长锚点
  for (let i = 0; i < 3; i++) {
    engine.tick([{ type: 'user', text: '所以那件事后来怎么样了', at: now + i * 60000 }], 't')
  }
  const after = engine.organs.pcc.read()
  ok(after.anchorCount > 0, `后扣带应长锚点，实际 ${after.anchorCount}`)
  ok(after.nostalgia >= 0 && after.continuity > 0, `怀旧/连续感应有读数，实际 nostalgia=${after.nostalgia} continuity=${after.continuity}`)
  const briefs = after.anchors.map((a) => a.brief)
  ok(briefs.length > 0, '锚点里要有真摘要')
  ok(!briefs.some((b) => String(b).startsWith('【情绪】')), `锚点里混进了情绪垃圾：${briefs.join(' / ')}`)

  // 反向对照：不给记忆时，锚点必须还是 0（否则上面那条断言是假的）
  const engine2 = createEngine({ bridge: { affect: () => null, episodes: () => [] } })
  for (let i = 0; i < 3; i++) {
    engine2.tick([{ type: 'user', text: '所以那件事后来怎么样了', at: now + i * 60000 }], 't')
  }
  ok(engine2.organs.pcc.read().anchorCount === 0,
    `没有记忆时必须不长锚点，实际 ${engine2.organs.pcc.read().anchorCount}`)
}

if (fails.length) {
  console.log(`FAIL ${fails.length}:`)
  for (const f of fails) console.log(` - ${f}`)
  process.exit(1)
}
console.log('PASS 记忆接缝（真拿到/挡情绪/null 语义）+ 后扣带锚点从 0 长出来 + 无记忆对照不长')
process.exit(0)
