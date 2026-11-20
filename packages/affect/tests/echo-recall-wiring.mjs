// 回声/刚想起/图式 的接线回归
// 以前的毛病：
//   1) 「记忆回声」永远取前 3 条 → 命中集稳定时几个月不变
//   2) 「刚想起」只读心情自己的 hip.recall，而它每拍被清成 null → 永远 —
//   3) 「图式」只看本地 cue 攒 3 次 → 永远 —
import { createEngine } from '../core/engine.js'
import { summarize } from '../core/dashboard.js'

const fails = []
const ok = (c, m) => { if (!c) fails.push(m) }

const a = { id: 'a', brief: '约定的第一件事', valence: 0.1, salience: 0.5, score: 0.9 }
const b = { id: 'b', brief: '约定的第二件事', valence: 0.0, salience: 0.4, score: 0.6 }
const c = { id: 'c', brief: '约定的第三件事', valence: -0.2, salience: 0.4, score: 0.5 }
const d = { id: 'd', brief: '约定的第四件事', valence: 0.2, salience: 0.3, score: 0.4 }
const e = { id: 'e', brief: '约定的第五件事', valence: 0.1, salience: 0.3, score: 0.3 }

const bridge = {
  recallFast: () => ({ hits: [a, b, c, d, e], degraded: false, valenceReady: true }),
  moodRerank: (hits) => hits,
  fastStage: () => 'ok',
  schemas: () => ['计划：明天去海边', '地点：楼下'],
  recall: async () => null,
  recentEpisodes: async () => [],
  salience: () => 0.3,
}

let t = Date.now()
const engine = createEngine({ bridge, now: () => t })

// 连续三句不同的话，各走一拍
const echoes = []
for (const text of ['第一句话', '第二句话', '第三句话']) {
  t += 5000
  engine.tick([{ type: 'user', text }])
  echoes.push((engine.read()?.memoryEcho?.hits ?? []).map(h => h.brief).join('|'))
}
ok(new Set(echoes).size >= 2, `三拍里回声应当至少换过一次，实际：${JSON.stringify(echoes)}`)
ok(echoes.every(s => s.length > 0), '每一拍都应当有回声')

const f = engine.read()
ok(Array.isArray(f.memorySchemas) && f.memorySchemas.length === 2, `图式应当从皮层概念来，实际：${JSON.stringify(f.memorySchemas)}`)

const sum = summarize(engine)
ok(sum.memory.recall && sum.memory.recall.length > 0, `刚想起应当有值，实际：${JSON.stringify(sum.memory.recall)}`)
ok(sum.memory.recallSource === 'memory', `刚想起来源应当是 memory，实际：${sum.memory.recallSource}`)
ok(Array.isArray(sum.memory.schemas) && sum.memory.schemas.length === 2, `面板图式应当两条，实际：${JSON.stringify(sum.memory.schemas)}`)
ok(sum.memory.recall === (f.memoryEcho?.hits?.[0]?.brief ?? null), '刚想起必须等于这一拍回声的第一条（同源）')

if (fails.length) {
  console.log(`FAIL ${fails.length}:`)
  for (const x of fails) console.log(' - ' + x)
  process.exit(1)
}
console.log(`PASS 回声会轮换（${echoes.map(s => s.split('|')[0]).join(' → ')}）· 刚想起同源 · 图式来自皮层`)
process.exit(0)
