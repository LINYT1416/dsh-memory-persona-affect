// 情绪曲线：五段 + 二次高峰 + 不应期 + 惯性 + 强度-时长权衡。
// 覆盖 W01 W02 W06 W07 W08 W09 W10。

import { clamp } from '../core/consts.js'

const PHASES = ['attack', 'peak', 'plateau', 'decay', 'residual']

export function create() {
  const fresh = () => ({
    onsetAt: 0, intensity: 0.1, last: 0.1,
    // 最近一次"输入强度"（岛叶给的那一下），用来判断是不是新的一波。
    // 不能拿 s.intensity（经过惯性和形状后的输出）当基准：输出跟不上输入时，
    // 每一拍都会被当成"又发作"，曲线就永远停在 attack 段。
    raw: 0,
    refractoryUntil: 0, secondPeakAt: 0, secondUntil: 0,
    // 这一波情绪最重到了哪（强度/威胁取大）；够重才谈得上"又拱上来"
    peak: 0,
    // 这一波已经拱过一次了：不重开一段就不许再拱（否则强威胁持续时每拍都算"第二峰"）
    secondPeakUsed: false,
    // 最近一帧的时间：read() 不能拿真实时钟去比模拟时钟（测试/补算里会直接判错）
    now: 0,
    ambivalence: 0, phase: 'attack', frame: 0,
  })
  let s = fresh()

  return {
    id: 'curve',
    cover: ['W01', 'W02', 'W06', 'W07', 'W08', 'W09', 'W10'],
    step(w) {
      const now = Number(w?.tx?.t1)
      const clock = Number.isFinite(now) ? now : Date.now()
      s.now = clock
      const ins = w.get('insula')
      const amy = w.get('amygdala')
      const dmn = w.get('dmn')
      const raw = clamp(ins?.felt.intensity ?? 0, 0, 1)
      const threat = amy?.threat ?? 0

      // W01 五段：发作快、平台、衰减、残留
      // 新的"发作"（身体感突然拉高）才重开一段；peak 跟着这一段重置，
      // 不然上一波的重度会一直挂着，随便一句话都算"又冒上来"。
      const newOnset = raw > (s.raw ?? 0) + 0.12
      s.raw = raw
      if (newOnset) {
        s.onsetAt = clock
        s.intensity = raw
        s.peak = Math.max(raw, threat)
        // 新的一段：上一波的回潮作废，允许这一段再拱一次
        s.secondPeakUsed = false
        s.secondUntil = 0
      } else s.intensity = clamp(raw, 0, 1)
      if (Math.max(raw, threat) > s.peak) s.peak = Math.max(raw, threat)
      const age = clock - s.onsetAt
      const phase = age < 2_000 ? 'attack' : age < 180_000 ? 'peak' : age < 1_200_000 ? 'plateau' : age < 10_800_000 ? 'decay' : 'residual'

      // W09 强度-时长权衡：高强度半衰短
      const half = s.intensity > 0.7 ? 40 : s.intensity > 0.4 ? 90 : 150
      const shaped = phase === 'attack' ? s.intensity * 0.7
        : phase === 'peak' ? s.intensity
          : phase === 'plateau' ? s.intensity * 0.95
            : phase === 'decay' ? s.intensity * Math.exp(-(age - 1_200_000) / (half * 60_000))
              : s.intensity * 0.15

      // W02 二次高峰：一股情绪过了顶之后，自己又拱上来一下。
      // 以前要同时满足"反刍 > 0.4"和"过了五分钟"——没有记忆锚点时反刍永远是 0，
      // 于是强刺激再怎么重，这一格也永远是 0。现在：起点够重 + 人还在这个劲里
      // （威胁没散 / 反刍 / 余温还不低），五到三十分钟内冒一次，只冒一次。
      const rum = clamp(Number(dmn?.rumination ?? 0), 0, 1)
      const inWindow = age > 300_000 && age < 1_800_000
      // 这股劲还在不在：不只看当下这一刻的威胁（它掉得快），
      // 也看"刚被扎得多重"按二十分钟量级衰减下来的余温——所以隔几分钟才一拍也能冒。
      const hot = s.peak * Math.exp(-age / 1_200_000)
      let second = 0
      if (!s.secondPeakUsed && inWindow && s.peak >= 0.4 && (rum > 0.3 || hot > 0.1)) {
        s.secondPeakAt = clock
        s.secondUntil = clock + 600_000
        s.secondPeakUsed = true       // 这一波的回潮用掉了，要再来一次得重新被扎
        second = 0.18 + 0.10 * rum
      }

      // W08 不应期：强威胁后一段时间哄不动
      if (threat > 0.6) s.refractoryUntil = Math.max(s.refractoryUntil, clock + 600_000)
      const refractory = clock < s.refractoryUntil

      // W07 惯性：变化有上限
      const target = clamp(shaped + second, 0, 1)
      const maxStep = 0.25
      s.last = clamp(s.last + clamp(target - s.last, -maxStep, maxStep), 0, 1)

      // W10 矛盾情绪：两股同时高于 0.4
      s.ambivalence = clamp((w.emotions ?? []).filter(e => e.intensity > 0.4).length > 1 ? 1 : 0, 0, 1)

      s.intensity = s.last
      s.phase = phase
      s.frame += 1
    },
    read() {
      const now = Number.isFinite(s.now) && s.now > 0 ? s.now : Date.now()
      return {
        frame: s.frame,
        phase: s.phase,
        intensity: s.intensity,
        refractory: s.refractoryUntil > now,   // W08 不应期：真的看时间（模拟时钟，不是墙钟）
        ambivalence: s.ambivalence,
        // 第二峰只在"又拱上来"那十分钟里对外可见；过了就不该一直挂着。
        // （原始时间戳留在 snapshot().secondPeakAt 里，给探针/面板查。）
        secondPeak: s.secondUntil > now ? s.secondPeakAt : 0,
      }
    },
    snapshot: () => ({ ...s }),
    restore(o) { if (o) s = { ...fresh(), ...o } },
    health: () => ({ ok: true, degraded: false, frame: s.frame }),
  }
}
