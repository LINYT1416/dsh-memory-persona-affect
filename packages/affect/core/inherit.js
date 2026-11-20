// 继承旧心情插件（mood-v2）的最后一帧，当作新插件的初始状态。
// 只取"状态量"（心情、疲惫、饥饿、周期、信任、注意力…），不取历史事件。
// 之后完全按新内核的规律演化。

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'

const clamp = (x, a, b) => Math.max(a, Math.min(b, x))

export function readLegacy(home = process.env.DSH_HOME || join(homedir(), '.dsh')) {
  const p = join(home, 'mood-v2', 'state.json')
  try {
    const s = JSON.parse(readFileSync(p, 'utf8'))
    if (!s || s.v !== 2) return null
    return { path: p, state: s }
  } catch { return null }
}

/** 旧状态 → 新内核的局部快照（只填状态，不动结构） */
export function mapLegacy(s) {
  const valence = clamp(Number(s?.inner?.valence) || 0, -1, 1)
  const arousal = clamp(Number(s?.inner?.arousal) || 0.2, 0, 1)
  const mask = clamp(Number(s?.mask) || 0, 0, 1)
  const sleepDebt = clamp(Number(s?.body?.sleepDebt) || 0, 0, 1)
  const hunger = clamp(Number(s?.body?.hunger) || 0, 0, 1)
  const social = clamp(Number(s?.mind?.social) || 0.5, 0, 1)
  const focus = clamp(Number(s?.mind?.focus) || 0.5, 0, 1)
  const longTerm = clamp(Number(s?.longTerm?.valence) || 0, -1, 1)

  return {
    mood: valence,
    organs: {
      pfc: {
        suppression: mask,
        bandwidth: clamp(0.82 - 0.5 * mask - 0.15 * sleepDebt, 0.15, 0.9),
        fatigue: clamp(sleepDebt * 0.6, 0, 1),
        display: { mask, leakRisk: clamp(mask * 0.35 + (valence < 0 ? 0.15 : 0), 0, 1) },
      },
      social: { trust: clamp(0.35 + 0.55 * social, 0, 0.85) },
      attention: { focus, salienceNet: clamp(0.3 + 0.4 * arousal, 0, 1) },
      hypothalamus: {
        hunger,
        sleepDebt,
        needs: { hunger, sleep: clamp(sleepDebt, 0, 1) },
        cycleStart: s?.cycle?.lastStart || null,
        cycleLen: Number(s?.cycle?.len) || 28,
      },
      neuromod: { serotonin: clamp(0.5 + 0.3 * valence, 0.1, 0.9) },
      endocrine: { cortisol: clamp(0.08 + 0.35 * sleepDebt, 0, 1) },
      bias: { neg: clamp(Math.max(0, -valence) * 0.35, 0, 1) },
      curve: { intensity: clamp(Math.abs(valence) * 0.7, 0, 1), phase: 'tail' },
    },
    meta: {
      inheritedAt: new Date().toISOString(),
      source: 'mood-v2/state.json',
      from: s?.at || null,
      longTermValence: longTerm,
    },
  }
}

export function pickLegacy(home) {
  const hit = readLegacy(home)
  return hit ? mapLegacy(hit.state) : null
}
