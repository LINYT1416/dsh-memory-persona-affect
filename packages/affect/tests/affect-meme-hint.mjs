// 表情包怎么发，由心情决定（affect.io.memeHint）。
//
// 契约：还没走拍时给默认中性暗示（daily/neutral）；走一拍之后按心情变，
// 而且方向必须对——被夸 → 亮的；被说烦 → 丧的，概率也要低下去。
//
//   node tests/affect-meme-hint.mjs
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const home = mkdtempSync(join(tmpdir(), 'meme-'))
process.env.DSH_HOME = home

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

const mod = await import('../index.js')
mod.apply(ctx, {})

const core = services.get('affect.core')
const io = services.get('affect.io')
ok(Boolean(core) && Boolean(io), `服务没接上：core=${Boolean(core)} io=${Boolean(io)}`)

// ── 第一拍之前：给的是默认中性暗示，不是 null ───────────
const cold = io.memeHint()
ok(cold && typeof cold === 'object', `还没走拍就该给默认暗示，实际 ${JSON.stringify(cold)}`)
ok(cold.emotion === 'daily', `默认该是 daily，实际 ${cold.emotion}`)
ok(cold.style === 'neutral', `默认风格该是 neutral，实际 ${cold.style}`)

// ── 被夸：亮的、愿意发 ─────────────────────────────────
await core.poke('你真厉害，我开心死了')
const good = io.memeHint()
ok(good && typeof good === 'object', `被夸之后没给暗示：${JSON.stringify(good)}`)
ok(good.emotion === 'happy', `被夸该推 happy，实际 ${good?.emotion}`)
ok(good.style === 'bright', `被夸该是亮风格，实际 ${good?.style}`)
ok(good.allow === true, `开心时该允许发表情，实际 ${good?.allow}`)

// ── 被说烦：丧的、概率更低 ─────────────────────────────
await core.poke('今天真烦，什么都不想干')
const bad = io.memeHint()
ok(bad && typeof bad === 'object', `心烦之后没给暗示：${JSON.stringify(bad)}`)
ok(bad.emotion === 'sad', `心烦该推 sad，实际 ${bad?.emotion}`)
ok(bad.style === 'emo', `心烦该是丧风格，实际 ${bad?.style}`)
ok(Number(bad.probability) < Number(good.probability),
  `心烦时的发表情概率该更低：${bad?.probability} vs ${good?.probability}`)

// ── 两条都在 0..1 ──────────────────────────────────────
for (const [name, h] of [['happy', good], ['sad', bad]]) {
  const p = Number(h.probability)
  ok(Number.isFinite(p) && p >= 0 && p <= 1, `${name} 的 probability 越界：${h.probability}`)
}

// ── read() 是同一份心情的外供版本 ───────────────────────
const r = io.read()
ok(Number.isFinite(Number(r?.valence)), `io.read() 没给效价：${JSON.stringify(r)?.slice(0, 100)}`)
ok(Number(r.tick) >= 2, `io.read() 的 tick 该 ≥ 2，实际 ${r?.tick}`)

rmSync(home, { recursive: true, force: true })

if (fails.length) {
  console.log(`FAIL ${fails.length}:`)
  for (const f of fails) console.log(' - ' + f)
  process.exit(1)
}
console.log(`PASS 表情包暗示（被夸 ${good.emotion}/${good.style} p=${Number(good.probability).toFixed(2)}；心烦 ${bad.emotion}/${bad.style} p=${Number(bad.probability).toFixed(2)}；空拍默认）`)
process.exit(0)
