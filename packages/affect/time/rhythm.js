// 时间节律：周节律 / 季节光照 / 长期人格漂移。覆盖 W04 W05 W06。

import { clamp, dayKey } from '../core/consts.js'

export function create() {
  const fresh = () => ({ weekly: 0, seasonal: 0, drift: 0, lastDay: '', frame: 0 })
  let s = fresh()

  return {
    id: 'rhythm',
    cover: ['W04', 'W05', 'W06'],
    step(w) {
      const t1 = Number(w.tx?.t1) || 0
      const d = new Date(t1)
      const dt = clamp(Number(w.tx?.dtMs) || 0, 0, 86_400_000)
      const mood = Number(w.mood) || 0
      const dow = d.getDay() // 0 周日
      const hour = d.getHours() + d.getMinutes() / 60

      // W04 周节律：周一最低，周五最高。
      // 以前整周只有"周一/周五/周末/其它"四个死值，一天之内钉在同一个数上；
      // 现在再加一层很轻的日内起伏（早上最沉，傍晚松一点），时间往前推它就会动。
      const weekBase = dow === 1 ? -0.12 : dow === 5 ? 0.08 : (dow === 0 || dow === 6) ? 0.04 : 0
      const dayWave = 0.015 * Math.cos(((hour - 17) / 24) * Math.PI * 2)
      s.weekly = clamp(weekBase + dayWave, -0.3, 0.3)

      // W05 季节：按日长连续算（夏至最长、冬至最短），不是按月份拍几个整数
      const dayOfYear = Math.floor((t1 - new Date(d.getFullYear(), 0, 1).getTime()) / 86_400_000) + 1
      s.seasonal = clamp(0.05 * Math.sin(((dayOfYear - 81) / 365) * Math.PI * 2), -0.06, 0.06)

      // W06 长期漂移：以前只在"跨天"那一拍才动一次，同一天里怎么聊都纹丝不动。
      // 现在按小时往当下心情慢慢靠（慢变量），跨天时再走一大步（日历的节拍）。
      // 幅度上限 ±0.1：三十天的长期漂移只挪基线一点点，不是把性格换掉。
      const h = dt / 3_600_000
      s.drift = clamp(s.drift * (1 - 0.02 * h) + mood * 0.02 * h, -0.1, 0.1)
      const today = dayKey(t1)
      if (s.lastDay !== today) {
        s.lastDay = today
        s.drift = clamp(s.drift * 0.98 + mood * 0.02, -0.1, 0.1)
      }
      s.frame += 1
    },
    read() {
      return { frame: s.frame, weekly: s.weekly, seasonal: s.seasonal, drift: s.drift, bias: clamp(s.weekly + s.seasonal + s.drift, -0.4, 0.4) }
    },
    snapshot: () => ({ ...s }),
    restore(o) { if (o) s = { ...fresh(), ...o } },
    health: () => ({ ok: true, degraded: false, frame: s.frame }),
  }
}
