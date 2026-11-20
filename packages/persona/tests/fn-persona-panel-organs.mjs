import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createPanel } from '../panel.js'
const home = mkdtempSync(join(tmpdir(), 'org-'))
const reads = {
  str: { s: 0.4 }, tpj: { offense: 0.2, misread: 0.1 },
  ofc: { warm: 0.6, unfair: 0.3 }, acc: { conflict: 0.5 },
  mpfc: { esteem: 0.7, idealGap: 0.2 }, pcc: { crisis: 0.1, nostalgia: 0.3 },
}
const panel = createPanel({
  home,
  engine: { read: () => ({ hex: {}, traits: {}, reads }), snapshot: () => ({}), restore: () => {} },
  clamp: (v, a, b) => Math.max(a, Math.min(b, v)),
  setPersona: () => ({ ok: true }),
  episodes: () => [], refreshEpisodes: async () => ({ ok: true }),
  styleSamples: async () => [], readAffect: () => null,
})
const snap = panel.snapshot()
const keys = Object.keys(snap.organs || {})
const fails = []
for (const k of ['str', 'tpj', 'ofc', 'acc', 'mpfc', 'pcc']) {
  if (!snap.organs?.[k]) fails.push('缺器官 ' + k)
}
if (Number(snap.organs?.ofc?.warm) !== 0.6) fails.push('ofc.warm 没透出来：' + JSON.stringify(snap.organs?.ofc))
rmSync(home, { recursive: true, force: true })
if (fails.length) { fails.forEach((f) => console.log('FAIL ' + f)); process.exit(1) }
console.log(`PASS 仪表页六器官读数（${keys.join('/')}；ofc.warm=${snap.organs.ofc.warm}，mpfc.idealGap=${snap.organs.mpfc.idealGap}）`)
