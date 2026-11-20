// 调质：小时级余韵。少了它，只有瞬时没有"吵完半天看什么都烦"。
// 对应文档：4.1 时间常数毫秒到小时、4.2 NE + 糖皮质激素、4.7 PTSD。
// 对应功能总表：A2-1、A2-2、A2-6、L8、R1。

export const NE_HALF = 40 * 60 * 1000      // 去甲肾上腺素，40 分钟半衰
export const CORT_HALF = 3 * 60 * 60 * 1000 // 皮质醇，3 小时半衰
export const GAIN_MAX = 0.25                // 基线最多抬 25%

const clamp01 = (n) => Math.max(0, Math.min(1, Number(n) || 0))

export function makeTone(state) {
  if (!state.tone) state.tone = { ne: 0, cort: 0, updatedAt: Date.now() }

  function decay(now = Date.now()) {
    const t = state.tone
    // 注意：updatedAt 可能是 0（测试里传 at=0），不能用 || 兜底
    const updatedAt = Number.isFinite(Number(t.updatedAt)) ? Number(t.updatedAt) : now
    const dt = Math.max(0, now - updatedAt)
    if (dt > 0) {
      const kne = Math.pow(0.5, dt / NE_HALF)
      const kc = Math.pow(0.5, dt / CORT_HALF)
      t.ne = clamp01(t.ne * kne)
      t.cort = clamp01(t.cort * kc)
      t.updatedAt = now
    }
    return t
  }

  /**
   * 注入。两个来源不能混（A2-1 的因果链）：
   *   事件本身 → NE
   *   CeA 表达 → 皮质醇
   * cea 关掉时皮质醇不释放，但 NE 照常（R14）。
   */
  function inject({ arousal = 0, polarity = 0, extreme = false, via = 'event' } = {}, switches = null, now = Date.now()) {
    decay(now)
    const a = clamp01(arousal)
    if (a <= 0) return snapshot(now)

    const negBias = polarity < 0 ? 1.1 : 1
    const amount = a * (extreme ? 1.2 : 1) * negBias

    if (via === 'event') {
      state.tone.ne = clamp01(state.tone.ne + 0.3 * amount)
    }
    // 皮质醇走 CeA：没有 CeA 就没有应激激素
    const ceaOn = !switches || !switches.nucleusIsOff?.('cea')
    if (ceaOn) {
      state.tone.cort = clamp01(state.tone.cort + 0.15 * amount)
    }
    state.tone.updatedAt = now
    return snapshot(now)
  }

  /** gate 压皮质醇；NE 压不住（"不表达了，但还是心慌"）。 */
  function suppressCort(factor = 0.7, now = Date.now()) {
    decay(now)
    const f = Math.max(0, Math.min(1, Number(factor) || 0))
    state.tone.cort = clamp01(state.tone.cort * f)
    state.tone.updatedAt = now
    return snapshot(now)
  }

  /** 基线增益：1 .. 1.25。 */
  function gain(now = Date.now()) {
    decay(now)
    return Number((1 + GAIN_MAX * state.tone.ne).toFixed(4))
  }

  function snapshot(now = Date.now()) {
    decay(now)
    return {
      ne: Number(state.tone.ne.toFixed(4)),
      cort: Number(state.tone.cort.toFixed(4)),
      gain: gain(now),
      at: state.tone.updatedAt,
    }
  }

  return { decay, inject, suppressCort, gain, snapshot }
}
