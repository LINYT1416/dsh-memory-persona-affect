// 被占便宜的说法：既要有情绪分量，也要**真的学到怕**，而且记在对的词上。
//
// 这条链路以前断在三处（都修了）：
//   1. 配对词表 NEG_EVENT_RE 不认 跑路/失联/赖账/甩锅
//   2. 情绪词表 NEG_WORDS 连「恨」都没有 → polarity 不到负
//   3. pickCue 截动词尾巴的表太短 → 「中介收钱跑路」抽出的 cue 是「中介收」，
//      以后没人会说这个词，caution('中介') 永远 null
//
//   node tests/amygdala-negative-lexicon.mjs
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const root = mkdtempSync(join(tmpdir(), 'amylex-'))
process.env.DSH_HOME = root
process.env.HIPPOCAMPUS_DIR = join(root, 'hippocampus')
process.env.CORTEX_DIR = join(root, 'cortex')
process.env.AMYGDALA_DIR = join(root, 'amygdala')

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

const cases = [
  ['那个中介收钱跑路了，我恨他', '中介'],
  ['那个房东赖账不退押金', '房东'],
  ['那个中介收了定金就失联了', '中介'],
  ['那个中介骗了我，我气死了', '中介'],
]

const seen = []
for (const [text, subject] of cases) {
  const r = await amy.observe({ text, session: 's1', at: Date.now() })
  const score = Number(r?.score)
  const polarity = Number(r?.polarity)
  ok(Number.isFinite(score) && score > 0, `没给分数：${text} → ${JSON.stringify(r)?.slice(0, 120)}`)
  ok(polarity < 0, `这句该是负性（polarity<0），实际 ${polarity}：${text}`)

  const c = amy.caution(subject)
  ok(c && Number(c.level) > 0,
    `学不到怕，或者记错了词（应为「${subject}」）：${text} → ${JSON.stringify(c)}`)
  ok(String(c?.subject) === subject,
    `cue 抽歪了：该记「${subject}」，实际记「${c?.subject}」（原文：${text}）`)
  seen.push(`${subject}${c.level}`)
}

// 平常的正面/中性句子不该被误记成怕
await amy.observe({ text: '今天中午吃了牛肉面，挺香的', session: 's1', at: Date.now() })
ok(amy.caution('牛肉面') === null, '「牛肉面」不该被记成怕的东西')

rmSync(root, { recursive: true, force: true })

if (fails.length) {
  console.log(`FAIL ${fails.length}:`)
  for (const f of fails) console.log(' - ' + f)
  process.exit(1)
}
console.log(`PASS 负性词表与 cue（${cases.length} 种说法都学到怕：${seen.join(' / ')}；面不误记）`)
process.exit(0)
