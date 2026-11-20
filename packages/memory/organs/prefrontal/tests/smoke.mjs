// 冒烟：在假宿主里 apply() 一次，确认挂载、工具、服务、面板都不炸。
// 跑法：node tests/smoke.mjs
import './env.mjs'
import { apply } from '../index.js'
import { makeCands } from './fixtures.mjs'

const provided = new Map()
const tools = new Map()
const deps = []

// 真实 Cordis 里 tools/agents 都是服务，只能 ctx.get(name) 拿；
// 假宿主也照这个来，否则插件接不上会被测成"通过"。
const services = new Map([
  ['tools', {
    get: (n) => tools.get(n),
    register: (t) => tools.set(t.name, t),
  }],
  ['agents', { list: () => [] }],
])

const ctx = {
  get: (n) => provided.get(n) ?? services.get(n) ?? null,
  provide: (n, v) => provided.set(n, v),
  set: (n, v) => provided.set(n, v),
  on: () => () => {},
  effect: (fn) => { deps.push(fn); return fn },
  webServer: null,
}

let pass = 0
let fail = 0
function line(name, r, err) {
  const note = r !== undefined ? `  → ${typeof r === 'object' ? JSON.stringify(r).slice(0, 120) : r}` : ''
  if (err) console.log(`  ✗ ${name}\n      ${err}`)
  else console.log(`  ✓ ${name}${note}`)
}
function t(name, fn) {
  try {
    const r = fn()
    pass += 1
    line(name, r)
  } catch (e) {
    fail += 1
    line(name, undefined, e?.message || e)
  }
}
async function ta(name, fn) {
  try {
    const r = await fn()
    pass += 1
    line(name, r)
  } catch (e) {
    fail += 1
    line(name, undefined, e?.message || e)
  }
}

console.log('\n前额叶 · 冒烟\n' + '='.repeat(52))

let api = null
t('apply() 不抛错', () => {
  const dispose = apply(ctx)
  if (typeof dispose !== 'function') throw new Error('apply 应返回卸载函数')
  return 'ok'
})

await ta('服务注册到 memory.prefrontal', async () => {
  api = provided.get('memory.prefrontal')
  if (!api) throw new Error('没注册服务')
  return Object.keys(api).length + ' 个方法'
})

await ta('工具注册齐全（至少 10 个）', async () => {
  const names = [...tools.keys()]
  if (names.length < 10) throw new Error(`只注册了 ${names.length} 个：${names.join(',')}`)
  return names.join(' ')
})

await ta('plan：单器官下也能出计划', async () => {
  const p = api.plan('我什么时候吃的火锅')
  if (!p.intent || !p.mode) throw new Error('计划不完整')
  return `${p.intent}/${p.mode}`
})

await ta('judge：没有器官也不炸', async () => {
  const r = api.judge(makeCands().slice(0, 5), { plan: api.plan('火锅') })
  if (!Array.isArray(r.verdicts)) throw new Error('verdicts 不是数组')
  return `${r.verdicts.length} 条`
})

await ta('gate：噪声拦住', async () => {
  const g = api.gate('嗯')
  if (g.keep !== false) throw new Error('噪声没拦住')
  return g.reason
})

await ta('retrieve：没有海马时返回空而不是抛错', async () => {
  const r = await api.retrieve('火锅')
  if (r.ok !== true) throw new Error('retrieve 失败')
  if (!Array.isArray(r.hits)) throw new Error('hits 不是数组')
  return `hits=${r.hits.length} elapsed=${r.elapsedMs}ms`
})

await ta('stats：能出全局状态', async () => {
  const s = await api.stats()
  if (!s.seams) throw new Error('缺 seams')
  return `missing=${s.seams.missing.length}`
})

await ta('hello：能力握手', async () => {
  const h = api.hello()
  if (typeof h.version !== 'number') throw new Error('没有版本')
  return `v${h.version} 器官=${Object.values(h.organs).filter(Boolean).length}`
})

await ta('工具能执行（prefrontal_stats）', async () => {
  const tool = tools.get('prefrontal_stats')
  const out = await tool.execute({}, { agent: { id: 'smoke' } })
  if (!out?.content?.[0]?.text) throw new Error('工具没返回内容')
  return 'ok'
})

await ta('工具能执行（prefrontal_recall）', async () => {
  const tool = tools.get('prefrontal_recall')
  const out = await tool.execute({ query: '火锅' }, { agent: { id: 'smoke' } })
  if (!out?.content?.[0]?.text) throw new Error('工具没返回内容')
  return 'ok'
})

await ta('卸载函数能跑', async () => {
  for (const fn of deps) { try { fn() } catch { /* 单个失败不影响 */ } }
  return `${deps.length} 个 effect 已清`
})

await ta('retrieve：有扩写且结果不足时，用扩写串再搜一轮', async () => {
  // 假器官：原句搜不到，只有"住院"才搜得到；皮层负责把"住院"扩出来
  const store2 = new Map()
  const fakeHippo = {
    recall: (q) => (String(q).includes('住院')
      ? { hits: [{ episodeId: 'ep_x', at: Date.now(), summary: '我妈说我爸住院了，下周手术', score: 0.5, why: ['bm25'] }], coverage: 1 }
      : { hits: [], coverage: 1 }),
  }
  const fakeCortex = { expand: (q) => `${q} 住院 手术` }
  const ctx2 = {
    get: (n) => ({
      'memory.hippocampus': fakeHippo,
      'memory.cortex': fakeCortex,
      tools: { get: () => null, register: () => {} },
      agents: { list: () => [] },
    }[n] ?? null),
    provide: (n, v) => store2.set(n, v),
    set: (n, v) => store2.set(n, v),
    on: () => () => {},
    effect: (f) => f,
    webServer: null,
  }
  apply(ctx2)
  const api2 = store2.get('memory.prefrontal')
  const r = await api2.retrieve('家里出什么事了')
  if (r.rounds.length < 2) throw new Error(`只跑了 ${r.rounds.length} 轮，扩写轮没触发`)
  if (r.rounds[1].strategy !== 'expand') throw new Error(`第二轮不是 expand，是 ${r.rounds[1].strategy}`)
  if (!r.hits.some((h) => h.id === 'ep_x')) throw new Error('扩写轮没把住院那条捞回来')
  return `2 轮，第二轮回 ${r.hits.length} 条`
})

console.log('\n' + '='.repeat(52))
console.log(`通过 ${pass} / 失败 ${fail}`)
process.exit(fail === 0 ? 0 : 1)
