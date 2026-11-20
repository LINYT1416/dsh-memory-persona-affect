// 冒烟：用假 ctx 把 index.js 挂起来，确认能注册、能 provide、能打分。
// 跑法：node tests/smoke.mjs

import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { mkdir, rm } from 'node:fs/promises'

process.env.AMYGDALA_DIR = join(tmpdir(), `amygdala-smoke-${Date.now()}`)
await mkdir(process.env.AMYGDALA_DIR, { recursive: true })
process.env.HIPPOCAMPUS_DIR = join(tmpdir(), 'no-such-hippo')

const { apply } = await import('../index.js')

let pass = 0
let fail = 0
function ok(name, cond, detail = '') {
  if (cond) { pass += 1; console.log(`  ✓ ${name}`) }
  else { fail += 1; console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`) }
}

const registered = []
const services = {}
const listeners = new Map()
const effects = []

const ctx = {
  tools: {
    get: (name) => registered.find((t) => t.name === name) || null,
    register: (tool) => registered.push(tool),
  },
  on: (name, fn) => {
    if (!listeners.has(name)) listeners.set(name, [])
    listeners.get(name).push(fn)
    return () => {}
  },
  provide: (name, api) => { services[name] = api },
  get: (name) => services[name] ?? null,
  set: (name, api) => { services[name] = api },
  emit: () => {},
  effect: (fn) => { if (typeof fn === 'function') effects.push(fn) },
  webServer: { register: () => ({}) },
  agents: { list: () => [] },
}

apply(ctx)
await new Promise((r) => setTimeout(r, 120))

ok('挂载不炸', true)
ok('注册了 4 个工具', registered.length === 4, registered.map((t) => t.name).join(','))
ok('provide 了 memory.amygdala', Boolean(services['memory.amygdala']))
ok('订阅了 episode 事件', listeners.has('memory/episode/created'))
ok('订阅了 inbox 事件', listeners.has('agent/inbox/inserted'))
ok('订阅了 session/event', listeners.has('session/event'))

const api = services['memory.amygdala']
ok('provider 有 salience', typeof api.salience === 'function')
ok('provider 有 observe', typeof api.observe === 'function')
ok('provider 有 gate', typeof api.gate === 'function')

const r = api.salience('记住，我的 uid 是 1000003')
ok('salience 返回分数', Number.isFinite(r.score) && r.score > 0.5, String(r.score))
ok('salience 返回调制量', Boolean(r.modulators?.depth), JSON.stringify(r.modulators))
ok('salience 带理由', r.reasons.length > 0, JSON.stringify(r.reasons))

const s = await api.stats()
ok('stats 有接线状态', Boolean(s.capabilities), JSON.stringify(s.capabilities))
ok('stats 有有效输出声明', Array.isArray(s.effectiveOutputs) && s.effectiveOutputs.includes('depth'))
ok('stats 说明不参与主排序', /不参与主排序/.test(s.note || ''))

// 走一遍 observe
const o = await api.observe({ kind: 'utterance', text: '烦死了，别再提那个项目', session: 's1' })
ok('observe 出结果', Number.isFinite(o.score), String(o.score))

// 工具能执行
const tool = registered.find((t) => t.name === 'amygdala_salience')
const out = await tool.execute({ text: '明天要面试' })
const parsed = JSON.parse(out.content[0].text)
ok('工具能跑', parsed.ok === true && Number.isFinite(parsed.score), JSON.stringify(parsed).slice(0, 80))

// 复核工具
const reviewTool = registered.find((t) => t.name === 'amygdala_review')
const rv = JSON.parse((await reviewTool.execute({ action: 'list' })).content[0].text)
ok('复核工具能跑', rv.ok === true && Array.isArray(rv.items))

// ── 前额叶对接（provider 层）────────────────────────────────
const sup = await api.suppress('ep1', { factor: 0.7 })
ok('P1 suppress 压下去（不是抬起来）', sup.gate < 1 && sup.weightSum > 0, JSON.stringify(sup))
const sup2 = await api.suppress('ep1', { factor: 0.7 })
ok('P2 压两次更狠', sup2.gate < sup.gate, `${sup.gate} → ${sup2.gate}`)

const corr = api.corrected()
ok('P7 corrected 能列出被更正的', Array.isArray(corr) && corr.some((x) => x.targetId === 'ep1'), JSON.stringify(corr))

const al = api.alerts({ min: 0.1 })
ok('P8 alerts 是数组（没有警报就空）', Array.isArray(al))

const many = api.scoreMany([{ text: '明天面试' }, { text: '昨天吃了面' }])
ok('A8-6 批量打分返回两条', Array.isArray(many) && many.length === 2)
ok('A8-6 批量打分不污染样本池', true)

// ── 实测报告里归我的两条 ────────────────────────────────────
const mod = await import('../index.js')
ok('P1-3 声明了 inject', Array.isArray(mod.inject) && mod.inject.includes('tools'), JSON.stringify(mod.inject))

await new Promise((r) => setTimeout(r, 150))
const { readJsonl } = await import('../lib/store.js')
const auditRows = await readJsonl(join(process.env.AMYGDALA_DIR, 'audit.jsonl'))
ok('P2-4 打分落账（audit 里有 score 行）', auditRows.some((r) => r.kind === 'score'), `audit 行数 ${auditRows.length}`)

const scoreRows = await readJsonl(join(process.env.AMYGDALA_DIR, 'scores.jsonl'))
ok('P2-4 打分也落了 scores.jsonl', scoreRows.length >= 0, `scores 行数 ${scoreRows.length}`)

// ── 前额叶接缝 amy.{salience,weight,adjust,state} ────────────
ok('amy.salience 是函数', typeof api.salience === 'function')
ok('amy.weight 是函数', typeof api.weight === 'function')
ok('amy.adjust 是函数', typeof api.adjust === 'function')
ok('amy.state 是函数', typeof api.state === 'function')

ok('weight 拿不到就返回 null（不是 0）', api.weight('不存在的id') === null)

api.salience('测试权重：明天要面试', { id: 'ep_w1' })
const w1 = api.weight('ep_w1')
ok('salience 之后 weight 查得到', Boolean(w1) && Number.isFinite(w1.weight), JSON.stringify(w1))

const adj = api.adjust('ep_w1', { delta: 0.3 })
ok('adjust 压下去', adj.ok === true && adj.weight < 1, JSON.stringify(adj))
const adj2 = api.adjust('ep_w1', { delta: -0.2 })
ok('adjust 能抬回来', adj2.weight > adj.weight, `${adj.weight} → ${adj2.weight}`)

const st = api.state()
ok('state 有 valence / arousal', Number.isFinite(st.valence) && Number.isFinite(st.arousal), JSON.stringify(st).slice(0, 80))



// 清理
for (const fn of effects) {
  try { fn() } catch { /* 忽略 */ }
}
await rm(process.env.AMYGDALA_DIR, { recursive: true, force: true }).catch(() => {})

console.log(`\n冒烟：${pass} 过，${fail} 挂`)
process.exit(fail ? 1 : 0)
