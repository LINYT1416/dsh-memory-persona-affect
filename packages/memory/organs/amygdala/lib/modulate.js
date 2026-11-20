// 调制量：资源分配的三个推子 + 摘要强度。
// 对应文档：4.2 "更多次重放、更强的摘要、更高的保留优先级"。
// 对应功能总表：A6-1 ~ A6-5、R8。
//
// 注意：depth 的阈值 0.65/0.35 是海马体写死的，
// 杏仁核只能给分，改不了档位（A6-1）。

const clamp01 = (n) => Math.max(0, Math.min(1, Number(n) || 0))

/** 编码深度：浅（只落 raw）/ 标准（建索引）/ 深（建索引 + 图边）。 */
export function depthOf(score) {
  const v = clamp01(score)
  if (v >= 0.65) return 'deep'
  if (v >= 0.35) return 'standard'
  return 'shallow'
}

/** 保留时长：海马公式是 2 + 6*sal（2–8 天），这里只对齐，不越权。 */
export function daysOf(score) {
  return Number((2 + 6 * clamp01(score)).toFixed(2))
}

/** 巩固轮次：高分多播一遍。 */
export function roundsOf(score) {
  return clamp01(score) >= 0.65 ? 2 : 1
}

/**
 * 摘要强度（A6-4）。海马现在不消费，但口开着。
 * R8：极端唤醒时强制 normal，不许 rich —— 倒 U 优先。
 */
export function summaryLevelOf(score, extreme = false) {
  if (extreme) return 'normal'
  const v = clamp01(score)
  if (v >= 0.8) return 'rich'
  if (v >= 0.35) return 'normal'
  return 'short'
}

/** 一次性给出四个调制量。 */
export function modulateOf(score, { extreme = false } = {}) {
  return {
    depth: depthOf(score),
    days: daysOf(score),
    rounds: roundsOf(score),
    summaryLevel: summaryLevelOf(score, extreme),
  }
}

/** 给下游皮层：优先写入的强度。没接就空转（E5）。 */
export function prioritizeOf(score, reasons = []) {
  return {
    priority: Number(clamp01(score).toFixed(4)),
    reasons: reasons.slice(0, 6),
    note: '给皮层的优先写入口，没接就空转',
  }
}
