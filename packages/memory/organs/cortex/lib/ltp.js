// LTP（F10）：一起出现的特征连边增强；重复出现的陈述权重增强。
export const LTP_STEP = 0.05
export const LTP_CAP = 1.5

export function ltpGain(evidenceCount = 1) {
  return Math.min(1.5, 1 + 0.2 * Math.max(0, evidenceCount - 1))
}

/** 在 LTD 之后调用，乘性加成，封顶 1.5（R3）。 */
export function applyLtp(weight, evidenceCount = 1) {
  const next = weight * ltpGain(evidenceCount)
  return Math.min(LTP_CAP, next)
}
