// #P2-9 置信度合成：四个可测信号 + 单调公式 + unknown 封顶。
// 公式：conf = 1 - Π(1 - w·s)，只对"有值"的信号算。
// 这不是拍脑袋：加一路证据只会让 conf 上升，不会下降（单调）。
// 有 unknown 时封顶 0.6——"有东西我不知道"比"我知道得不多"更该谨慎。
import { clamp, round } from './text.js'

export const WEIGHTS = { gap: 0.35, routes: 0.25, coverage: 0.25, hist: 0.15 }

/** 第 1 信号：top1 与 top2 的差距。只有一个候选时给 0.5（不确定）。 */
export function gapOf(hits = []) {
  const s = hits.map((h) => Number(h.score) || 0).filter((x) => x > 0).sort((a, b) => b - a)
  if (!s.length) return 0
  if (s.length === 1) return 0.5
  return clamp((s[0] - s[1]) / (s[0] || 1))
}

/** 第 2 信号：命中了几路 / 有几路可用。 */
export function routesScore(hitRoutes = [], available = 3) {
  if (!available) return 0
  return clamp(hitRoutes.length / available)
}

/** 第 4 信号：同类意图的历史命中率；样本不足时给 0.5 并标 cold。 */
export function histOf(calibration, intent) {
  const row = calibration?.[intent]
  if (!row || (row.n || 0) < 10) return { value: 0.5, cold: true }
  return { value: clamp(row.hit / row.n), cold: false }
}

/**
 * signals: [{name, value, w?}]
 * opts: { unknown: number, absent: number }
 */
export function compose(signals = [], opts = {}) {
  let rest = 1
  const used = []
  for (const s of signals) {
    if (!Number.isFinite(s?.value)) continue
    const w = Number.isFinite(s.w) ? clamp(s.w) : (WEIGHTS[s.name] ?? 0.2)
    const v = clamp(s.value)
    rest *= 1 - w * v
    used.push({ name: s.name, value: round(v), w })
  }
  let conf = 1 - rest
  const unknown = opts.unknown || 0
  const absent = opts.absent || 0
  if (unknown > 0) conf = Math.min(conf, 0.6)
  if (!used.length) conf = 0
  return {
    conf: round(clamp(conf)),
    signals: used,
    unknown,
    absent,
    capped: unknown > 0,
  }
}

export function explain(result) {
  const parts = result.signals.map((s) => `${s.name}=${s.value}×${s.w}`)
  return `conf ${result.conf} ← ${parts.join(' + ') || '无信号'}${result.capped ? '（有 unknown，封顶 0.6）' : ''}`
}
