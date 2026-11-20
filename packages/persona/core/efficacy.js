// S05 自我效能：我做不做得到。
// 依据：她答应过的事，成了几次、黄了几次（来自 M11 目标结果），不是自我感觉。
const SMOOTH = 2 // 拉普拉斯平滑：没做过事的时候不该极端自信或极端自卑

/**
 * @param {{done:number, failed:number}} goals
 * @returns {{ efficacy:number, line:string|null }}
 */
export function efficacyOf(goals = {}) {
  const done = Math.max(0, Number(goals.done) || 0)
  const failed = Math.max(0, Number(goals.failed) || 0)
  const total = done + failed
  const efficacy = (done + 1) / (total + SMOOTH)

  // 样本太少不下结论：没干过几件事，就别对自己下判断
  if (total < 3) return { efficacy: Number(efficacy.toFixed(3)), line: null }

  // 做成率低：先别答应
  if (efficacy < 0.35) return { efficacy: Number(efficacy.toFixed(3)), line: '这事我可能搞不定，先别答应下来' }
  // 做成率高：可以说一句"能行"
  if (efficacy > 0.72) return { efficacy: Number(efficacy.toFixed(3)), line: '这种我有把握' }
  return { efficacy: Number(efficacy.toFixed(3)), line: null }
}
