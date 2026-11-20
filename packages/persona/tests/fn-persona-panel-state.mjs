// 仪表页读数：/persona/state 里的 snapshot() 必须能跑通，且带上风格/外表/注入条数
// （线上曾因为它 throw 而返回 400，页面只能看个壳）
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createPanel } from '../panel.js'

const home = mkdtempSync(join(tmpdir(), 'panel-'))
const fails = []
const ok = (c, m, d = '') => { if (!c) { fails.push(m + ' — ' + d); console.log('FAIL ' + m + (d ? ' — ' + d : '')) } }

const panel = createPanel({
  home,
  engine: { read: () => ({ hex: { brevity: 0.4, warmth: 0.6 }, traits: { esteem: 0.5 }, emotions: [] }), snapshot: () => ({}), restore: () => {} },
  clamp: (v, a, b) => Math.max(a, Math.min(b, v)),
  setPersona: () => ({ ok: true }),
  episodes: () => [],
  refreshEpisodes: async () => ({ ok: true }),
  styleSamples: async () => [],
  readAffect: () => ({ mood: 0, valence: 0, brevity: 0.4, delayMs: 1000, meme: 0.5, emotions: [] }),
  relation: () => ({ debt: 2, intimacy: 0.44, turns: 40, apologies: 1, hurts: 0 }),
})

// 她自己的口吻：仪表页要能报出来，空自述时 style 该是 null（这也是对的）
panel.state.selfText = '性格：话多爱笑。\n- 面吃上了，有点咸但真香\n- 苦就苦呗，饭还是得吃。\n- 知道啦，你也别熬。'

let snap = null
try { snap = panel.snapshot() } catch (e) { ok(false, 'snapshot() 抛错了', e.message) }

if (snap) {
  ok(typeof snap.mode === 'string', '缺 mode')
  ok(snap.style && typeof snap.style.avgLen === 'number', '缺 style 读数', JSON.stringify(snap.style))
  ok(snap.style.source === 'selfText', '没有原句时 style 应该退回自述', String(snap.style.source))
  ok(snap.looks && typeof snap.looks.voice === 'string', '缺 looks', JSON.stringify(snap.looks && Object.keys(snap.looks)))
  ok(Number(snap.injectMax) >= 3, '缺 injectMax', String(snap.injectMax))
  ok(snap.now && 'hex' in snap.now, '缺 now.hex')
  ok(snap.relation && snap.relation.debt === 2, '关系账本没透到仪表页', JSON.stringify(snap.relation))
  ok(Number(snap.relation.intimacy) > 0.4, '亲密度不对', String(snap.relation && snap.relation.intimacy))
}

// 有原句时优先用原句：那才是她真正的口吻
const panel2 = createPanel({
  home,
  engine: { read: () => ({ hex: {}, traits: {}, emotions: [] }), snapshot: () => ({}), restore: () => {} },
  clamp: (v, a, b) => Math.max(a, Math.min(b, v)),
  setPersona: () => ({ ok: true }),
  episodes: () => [
    '我说：面吃上了，有点咸但真香', '我说：苦就苦呗，饭还是得吃', '我说：知道啦，你也别熬',
    '我说：崩了就崩了嘛，我又不会跑', '我说：行的呗，记它个人情啦', '我说：嗯，等我一会儿',
  ].map((brief) => ({ brief })),
  refreshEpisodes: async () => ({ ok: true }),
  styleSamples: async () => [],
  readAffect: () => null,
})
const snap2 = panel2.snapshot()
ok(snap2.style.source === 'episodes', '有原句时应该用原句量', String(snap2.style.source))
ok(Number(snap2.style.samples) >= 5, '原句条数不对', String(snap2.style.samples))
ok(snap2.style.avgLen < 25, '用原句量出来不该是说明书句长', String(snap2.style.avgLen))
ok(Number(snap2.style.shortSamples) >= 5, '短句样本数不对', String(snap2.style.shortSamples))
ok(Number(snap2.style.particleRate) > 0, '短句里的语气词没量到', JSON.stringify(snap2.style.particles))

rmSync(home, { recursive: true, force: true })
if (fails.length) process.exit(1)
console.log(`PASS 仪表页读数（mode=${snap.mode}；style 句均 ${snap.style.avgLen}；looks 有音色；injectMax=${snap.injectMax}）`)
