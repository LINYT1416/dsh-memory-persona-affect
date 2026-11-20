// X11 撒娇与示弱：只在"很熟"的时候才撒娇，而且要收得住。
// 人设：偶尔撒娇，撒完自己先肉麻。所以频率必须低。
const COOLDOWN = 3 * 60 * 60 * 1000

/**
 * @param {object} rel 关系账本快照 { intimacy }
 * @param {object} reads 六器官读数
 * @param {{lastCuteAt:number}} state
 */
export function decideCute(rel = {}, reads = {}, state = {}, now = Date.now()) {
  const n = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0)
  const intimacy = n(rel.intimacy)
  const warm = n(reads.ofc && reads.ofc.warm)
  const wanting = n(reads.str && reads.str.wanting)
  const offense = n(reads.tpj && reads.tpj.offense)
  const last = n(state.lastCuteAt)

  // 不熟不许撒娇；正在被怼时更不许
  if (intimacy < 0.6) return { cute: false, line: null, why: 'not-close' }
  if (offense > 0.35) return { cute: false, line: null, why: 'offended' }
  // 三小时内只撒一次
  if (now - last < COOLDOWN) return { cute: false, line: null, why: 'cooldown' }
  // 对方暖 或 心里很想要，才撒
  if (warm < 0.4 && wanting < 0.5) return { cute: false, line: null, why: 'no-cue' }

  return { cute: true, line: '……那你多陪我一会儿呗', why: 'close+warm' }
}

export function createCuteState() {
  const s = { lastCuteAt: 0 }
  return {
    decide(rel, reads, now = Date.now()) {
      const r = decideCute(rel, reads, s, now)
      if (r.cute) s.lastCuteAt = now
      return r
    },
    snapshot: () => ({ ...s }),
    restore: (x) => { if (x && typeof x === 'object') s.lastCuteAt = Number(x.lastCuteAt) || 0 },
  }
}
