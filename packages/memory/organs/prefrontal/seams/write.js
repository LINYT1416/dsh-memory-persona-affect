// #P5-6 回执：凡是"把活推给下游"的面，都必须有回执。
// 没有回执 = 只有发送方没有接收方 = 功能其实没实现。
export function receipt(name, requested = [], applied = [], opts = {}) {
  const req = (requested || []).length
  const app = (applied || []).length
  const ratio = req === 0 ? 1 : app / req
  return {
    name,
    requested: req,
    applied: app,
    ratio: Number(ratio.toFixed(2)),
    warn: ratio < (opts.min ?? 0.8),
    why: ratio < (opts.min ?? 0.8) ? '下游没执行够，功能等于没落地' : '正常',
  }
}

/** 把回执汇总成一行，给 telemetry 记。 */
export function digest(receipts = []) {
  if (!receipts.length) return { n: 0, minRatio: null, warn: 0 }
  const minRatio = Math.min(...receipts.map((r) => r.ratio))
  return {
    n: receipts.length,
    minRatio: Number(minRatio.toFixed(2)),
    warn: receipts.filter((r) => r.warn).length,
  }
}

/** 模拟一个"下游确实执行了"的回执（mock 用，真器官自己回）。 */
export function echo(constraints = [], draft = '') {
  const applied = constraints.filter((c) => draft.includes(String(c).slice(0, 4)) || c === 'hedge')
  return { applied, requested: constraints }
}
