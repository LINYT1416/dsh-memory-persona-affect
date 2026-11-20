// #P2-13 FOK（知道自己在哪知道）/ #P3-8 错误检测 / #P5-13 话题预演采信
// 元认知不是"给个分"，是分两种感觉：
//   A 有结果但不确定     → 说"我记得，但不太确定"
//   B 没结果但知道有     → 说"我学过，一时想不起来"
// 这两种的措辞完全不同，混成一个数就丢了。
import { clamp } from './text.js'

/**
 * @param {{hits:number, suppressed:number, coverage:number, intent:string, calibration:object}} ctx
 */
export function fok(ctx = {}) {
  const hits = Number(ctx.hits) || 0
  const suppressed = Number(ctx.suppressed) || 0
  const coverage = Number(ctx.coverage) || 0
  const row = ctx.calibration?.[ctx.intent]
  const learned = (row?.n || 0) >= 5 && (row?.hit || 0) / (row?.n || 1) > 0.3

  if (hits > 0) return { feeling: 'uncertain-recall', why: '有结果但置信不高', strength: clamp(0.3 + hits * 0.05) }
  if (suppressed > 0) return { feeling: 'suppressed', why: '被我压掉了，不是没有', strength: 0.6 }
  if (coverage > 0.5 && learned) return { feeling: 'tip-of-tongue', why: '库里有这类东西，这次没找到', strength: 0.5 }
  return { feeling: 'empty', why: '确实没有', strength: 0.1 }
}

/**
 * #P3-8 错误检测：用户说"不对"之后，同类意图的置信下调。
 * 没有这个入口，前额叶永远不会知道自己错了——这是它唯一的负反馈。
 */
export function onDeny(calibration, intent, opts = {}) {
  const c = { ...(calibration || {}) }
  const row = { ...(c[intent] || { n: 0, hit: 0, deny: 0 }) }
  row.n = (row.n || 0) + 1
  row.deny = (row.deny || 0) + 1
  row.hit = Math.max(0, (row.hit || 0) - (opts.penalty ?? 1))
  c[intent] = row
  return c
}

export function onOk(calibration, intent) {
  const c = { ...(calibration || {}) }
  const row = { ...(c[intent] || { n: 0, hit: 0, deny: 0 }) }
  row.n = (row.n || 0) + 1
  row.hit = (row.hit || 0) + 1
  c[intent] = row
  return c
}

/**
 * #P5-13 预演采信：海马给了 topicDirection，用不用由前额叶定。
 * 规矩：只在"话题稳定"时采信；刚切换话题时不采信（否则会把旧话题惯性带进来）。
 */
export function adopt(topicDirection, ctx = {}) {
  if (!topicDirection) return { use: false, why: '没有预演结果' }
  if (ctx.justSwitched) return { use: false, why: '刚切话题，不采信惯性' }
  if ((ctx.hits || 0) === 0) return { use: false, why: '这轮没命中，预演无依据' }
  return { use: true, why: '话题稳定，采信', value: topicDirection }
}
