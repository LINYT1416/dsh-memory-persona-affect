// 记忆桥 + 崩溃点检查
//   node tests/bridge.mjs
import { createEngine } from '../core/engine.js'
import { createBridge } from '../core/bridge.js'
import { writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createStore } from '../core/store.js'

const fails = []
const ok = (c, m) => { if (!c) fails.push(m) }

// ── 1. 假记忆器官：只读接口 ──
const fakeHip = {
  recall: (q) => q.includes('插件') ? [{ summary: '上次说插件跑通了又崩了', valence: -0.6 }] : [],
}
const fakeAmy = { salience: () => 0.8, caution: () => 0.5 }
const fakeCortex = { search: () => [{ text: '她做过硬件测试实习' }] }

const get = (id) => ({
  'memory.hippocampus': fakeHip,
  'memory.amygdala': fakeAmy,
  'memory.cortex': fakeCortex,
}[id] ?? null)

const bridge = createBridge(get)
ok(bridge.ready(), '桥应检测到记忆器官在线')
const r = bridge.recall('记忆插件又崩了')
ok(r && r.hits.length === 1 && r.tone < 0, 'recall 应返回负性命中')
ok(bridge.recall('今天天气') === null, '无关的话不该有命中')
ok(bridge.salience('x') === 0.8, '显著性先验应是 0.8')
ok(bridge.caution('插件') === 0.5, 'caution 应是 0.5')
ok(bridge.facts('实习')[0].includes('硬件'), 'facts 能读到事实')

// ── 2. 记忆影响情绪：同样的坏消息，有记忆时 threat 更高 ──
let clock = new Date('2026-11-12T14:00:00+08:00').getTime()
const withMem = createEngine({ now: () => clock, bridge })
withMem.tick([{ type: 'user', text: '记忆插件又崩了', at: clock }])
await new Promise(r => setTimeout(r, 10))
clock += 60_000
withMem.tick([])                      // 真海马体的 recall 是 async，第二拍才用上
const tWith = withMem.organs.amygdala.read().threat

clock = new Date('2026-11-12T14:00:00+08:00').getTime()
const noMem = createEngine({ now: () => clock })
noMem.tick([{ type: 'user', text: '记忆插件又崩了', at: clock }])
const tNo = noMem.organs.amygdala.read().threat
ok(tWith > tNo, `记忆命中时 threat 应更高（${tWith.toFixed(2)} vs ${tNo.toFixed(2)}）`)
ok(withMem.read().memoryEcho?.hits?.length === 1, '融合结果里应带 memoryEcho')

// ── 3. 回告：新情景产生时要发事件 ──
let announced = 0
const em = createEngine({ now: () => clock, bridge, emit: () => announced++ })
em.tick([{ type: 'user', text: '你行不行啊，这都做不好', at: clock }])
ok(announced >= 1, '新情景应回告记忆侧')

// ── 4. 桥全缺：不许崩 ──
const nullBridge = createBridge(() => null)
const e2 = createEngine({ now: () => clock, bridge: nullBridge })
let threw = false
try { e2.tick([{ type: 'user', text: '你好', at: clock }]) } catch (e) { threw = true }
ok(!threw, '记忆器官全缺时不该崩溃')
ok(!nullBridge.ready(), '全缺时 ready 应为 false')

// ── 5. 记忆器官抛异常：不许崩 ──
const badBridge = createBridge((id) => ({ recall: () => { throw new Error('boom') }, salience: () => { throw new Error('boom') }, search: () => { throw new Error('boom') }, caution: () => { throw new Error('boom') } }[id]))
const e3 = createEngine({ now: () => clock, bridge: badBridge })
threw = false
try { e3.tick([{ type: 'user', text: '插件', at: clock }]) } catch (e) { threw = true }
ok(!threw, '记忆器官抛错时不该崩溃')

// ── 6. 状态文件损坏：不许崩，能自愈 ──
const dir = join(tmpdir(), 'affect-test-' + Date.now())
mkdirSync(join(dir, 'affect'), { recursive: true })
writeFileSync(join(dir, 'affect', 'state.json'), '{ 这不是 JSON', 'utf8')
const store2 = createStore(dir)
ok(await store2.load(() => ({ a: 1 })).then(s => s.a === 1), '坏状态文件应回默认值')

// ── 7. restore 容错 ──
const e4 = createEngine({ now: () => clock })
threw = false
try { e4.restore(null); e4.restore({}); e4.restore({ schema: 99 }); } catch (e) { threw = true }
ok(!threw, 'restore 收到垃圾不该抛')

// ── 8. 长跑不炸 ──
const e5 = createEngine({ now: () => clock })
for (let i = 0; i < 500; i++) { clock += 60_000; e5.tick(i % 5 === 0 ? [{ type: 'user', text: '测试', at: clock }] : []) }
ok(Number.isFinite(e5.state.mood), '500 拍后 mood 仍有限')
ok(e5.organs.hippocampus.read().count <= 400, '情景数有上限')

// ── 9. 周期已开 ──
const cyc = e5.organs.hypothalamus.read().cycle
ok(cyc.on === true, '生理周期应默认开启')
ok(cyc.day >= 1 && cyc.day <= 28, '周期天数应在 1~28')

console.log(fails.length ? `FAIL ${fails.length}:\n- ` + fails.join('\n- ') : 'PASS 记忆桥与崩溃点全部通过')
process.exit(fails.length ? 1 : 0)
