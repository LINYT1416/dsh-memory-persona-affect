// #P5-12 巩固优先级供给 / #F17 写回海马
// 海马要"先重放谁"，原来没人给——这是它单器官期最难自己解决的事。
// 规矩：只给"排序建议"，不替它决定重放几次（那是它的 L4-8）。
import { goalFit, rewardCue, selfRef, clamp } from './text.js'

/**
 * 巩固优先级：价值/目标相关/是否被用过/时间。
 * 输出 0–1，越高越先重放。
 */
export function priority(cand, ctx = {}) {
  const parts = []
  parts.push({ name: 'goal', value: goalFit(cand.summary || '', ctx.goal) })
  parts.push({ name: 'reward', value: rewardCue(cand.summary) ? 0.8 : 0.4 })
  parts.push({ name: 'self', value: selfRef(cand.summary) ? 0.7 : 0.4 })
  parts.push({ name: 'usage', value: clamp((cand.hitCount || 0) / 5) })
  parts.push({ name: 'fresh', value: clamp(1 - (ctx.now - (cand.at || 0)) / (30 * 86400000)) })
  const total = parts.reduce((n, p) => n + p.value, 0) / parts.length
  return { score: Number(clamp(total).toFixed(4)), parts }
}

export function rankForConsolidation(cands = [], ctx = {}) {
  return [...cands]
    .map((c) => ({ id: c.episodeId || c.id, ...priority(c, ctx) }))
    .sort((a, b) => b.score - a.score)
    .map((x, i) => ({ ...x, rank: i + 1 }))
}

/**
 * #F17 写回海马。三个可选入参：
 *   target  检索目标（自由文本）
 *   exclude 抑制名单（"别往那边想"）
 *   boost   要抬的 key
 * 海马不认就忽略——绝不因此报错。
 */
export function hint(plan, suppressed = []) {
  const target = String(plan?.target?.hint?.target || '')
  const exclude = suppressed.map((s) => s.id).filter(Boolean).slice(0, 20)
  const boost = plan?.target?.hint?.boost || []
  return { target, exclude, boost, v: 1 }
}

/** 给海马的一句话说明：为什么这几条先。 */
export function explainPriority(ranked = []) {
  return ranked.slice(0, 3).map((r) => `${r.rank}.${r.id}:${r.score}`).join(' ')
}
