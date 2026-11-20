// 探针：人格的 threatGain 到底有没有进到"顺不顺意"和效价里
//   node packages/affect\_probe-persona.mjs
import { createEngine } from '../core/engine.js'

function run(pg) {
  let clock = new Date('2026-11-12T21:00:00+08:00').getTime()
  const e = createEngine({ now: () => clock })
  e.personaParams().threatGain = pg
  const rows = []
  for (let i = 0; i < 3; i += 1) {
    clock += 60_000
    e.tick([{ type: 'user', text: '你行不行啊，这都做不好', at: clock }], 'p')
    const f = e.read()
    rows.push({
      pg: e.personaParams().threatGain,
      appraisalThreatGain: f.appraisal?.threatGain,
      goal: Number((f.appraisal?.goal ?? 0).toFixed(4)),
      valence: Number((f.valence ?? 0).toFixed(4)),
      moodTarget: Number((f.moodTarget ?? 0).toFixed(4)),
    })
  }
  return rows
}

for (const pg of [1, 1.8, 0.5]) {
  const rows = run(pg)
  console.log('threatGain', pg, JSON.stringify(rows))
}
