// 心情接缝：只读，不写它的状态。
// 参数回写走 retune —— 那是"配置写"，跟"状态写"分开，单写者原则还成立。

function guard(fn, fallback) {
  try {
    const v = fn()
    return v === undefined ? fallback : v
  } catch {
    return fallback
  }
}

export function createAffectBridge(get) {
  return {
    present() {
      return Boolean(guard(() => get('affect.core'), null))
    },

    /** 引擎每帧调它，必须是同步的 */
    state() {
      const core = guard(() => get('affect.core'), null)
      if (!core?.read) return null
      const f = guard(() => core.read(), null)
      if (!f) return null
      const emotions = Array.isArray(f.emotions) ? f.emotions : []
      const io = f.io || {}
      return {
        mood: Number(f.mood ?? 0),
        valence: Number(f.valence ?? f.mood ?? 0),
        arousal: Number(f.arousal ?? 0.5),
        trust: Number(f.trust ?? 0.6),
        kind: emotions[0]?.kind || '',
        emotions: emotions.map((e) => String(e?.kind || '')).filter(Boolean),
        // 面板要看的"输出通道"读数：这些数在心情那边，人格自己算不出来
        brevity: Number.isFinite(Number(io.brevity)) ? Number(io.brevity) : null,
        delayMs: Number.isFinite(Number(io.replyDelayMs)) ? Number(io.replyDelayMs) : null,
        meme: Number.isFinite(Number(io.memeTendency)) ? Number(io.memeTendency) : null,
        memeQuery: String(io.meme?.query || ''),
        memeStyle: String(io.meme?.style || ''),
        tone: String(f.display?.toneShift || ''),
      }
    },

    /** 配置写：只改参数，不碰状态 */
    retune(cfg) {
      const core = guard(() => get('affect.core'), null)
      if (!core?.retune) return { ok: false, reason: 'no-retune' }
      try {
        core.retune(cfg)
        return { ok: true }
      } catch (e) {
        return { ok: false, reason: String(e?.message || e) }
      }
    },
  }
}
