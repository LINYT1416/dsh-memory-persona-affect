// 恐惧条件化：被坑过一次之后，再提到那个东西应该带警觉（caution 不再是 null）。
//
// 之前探测直接用"我被骗了"这种中性叙述，没触发 NEG_EVENT_RE；
// 这个测试用明确的负性事件，并且对多个候选实体查一遍——因为 cue 是"实体"不是"整句"。
//
//   node tests/amygdala-fear.mjs
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const root = mkdtempSync(join(tmpdir(), 'fear-'))
process.env.DSH_HOME = root
process.env.HIPPOCAMPUS_DIR = join(root, 'hippocampus')
process.env.CORTEX_DIR = join(root, 'cortex')

const fails = []
const ok = (c, m) => { if (!c) fails.push(m) }

const services = new Map()
const ctx = {
  systemPrompt: { context: () => () => {} },
  webServer: { register: () => () => {} },
  tools: { register: () => () => {}, get: () => null },
  agents: { list: () => [] },
  provide: (n, v) => services.set(n, v),
  set: (n, v) => services.set(n, v),
  get: (n) => services.get(n) || null,
  on: () => () => {},
  emit: () => true,
  effect: () => () => {},
  logger: { info() {}, warn() {}, error() {} },
}

const { apply } = await import('../index.js')
apply(ctx)
const amy = services.get('memory.amygdala')
ok(Boolean(amy), '没拿到 memory.amygdala')

// cue 是"实体"，抽出哪个字要看实体表：观察结果里的 caution.subject 才是准的。
// 所以先用 observe 的返回值，再拿它回查一遍。
let lastObserve = null
const probes = ['那个', '他', '骗', '骗子', '中介', '被骗']

async function anyCaution() {
  for (const p of probes) {
    const c = await amy.caution(p)
    if (c) return { probe: p, c }
  }
  return null
}

const before = await anyCaution()
ok(before === null, `还没发生任何事，caution 就该是 null，实际 ${JSON.stringify(before)?.slice(0, 120)}`)

// 明确负性事件：带"被骗"和怒气词，且同一句里有实体
lastObserve = await amy.observe({
  text: '那个中介骗了我三万块，我气死了，真想去报警',
  session: 's1',
  at: Date.now(),
})

if (lastObserve?.caution?.subject && !probes.includes(lastObserve.caution.subject)) probes.unshift(lastObserve.caution.subject)
const after = await anyCaution()
ok(after !== null, `被坑过一次之后，再提到相关东西仍无警觉：${probes.join('/')} 全是 null`)
if (after) {
  const c = after.c
  // cue 必须是有信息量的名词，不能是指代词或整句情绪片段
  const subj = String(c.subject || '')
  ok(!['那个','这个','他','她','它'].includes(subj), `cue 是指代词：${subj}`)
  ok(!/(气死|讨厌|难受|害怕|委屈)/.test(subj), `cue 是情绪片段：${subj}`)
  ok(subj === '中介', `这句话的 cue 应该是「中介」，实际是「${subj}」`)
  const strength = Number(c.strength ?? c.level ?? c.score ?? 0)
  ok(strength > 0, `caution 命中但强度是 0：${JSON.stringify(c).slice(0, 160)}`)
}

rmSync(root, { recursive: true, force: true })

if (fails.length) {
  console.log(`FAIL ${fails.length}:`)
  for (const f of fails) console.log(' - ' + f)
  process.exit(1)
}
console.log(`PASS 恐惧条件化（事前 null → 被骗后 "${after.probe}" 带警觉 ${JSON.stringify(after.c).slice(0, 120)}）`)
process.exit(0)
