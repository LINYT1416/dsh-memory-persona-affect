// 功能断言：表 4「海马体（情绪向）」M01–M18、表 6「调质层」T01–T08。
//   node tests/fn-hippo-neuromod.mjs
//
// 每条都是"给刺激 → 字段/行为跟着变"，不是"字段存在"。
// 层面：海马体/调质层单元（可直接给 salience、皮质醇、激素、活动），
//       以及需要下游消费的地方（杏仁核 threat、引擎 fuse 的 appraisal）。

import { create as createHippocampus } from '../organs/hippocampus.js'
import { create as createNeuromod } from '../layers/neuromod.js'
import { create as createAmygdala } from '../organs/amygdala.js'
import { createEngine } from '../core/engine.js'

const MIN = 60_000
const DAY = 86_400_000
const T0 = new Date('2026-11-12T20:00:00+08:00').getTime()

const results = []
const ok = (id, cond, msg) => {
  results.push({ id, pass: !!cond, msg })
  console.log(`${cond ? `ok: ${id}` : `FAIL ${id}`}${msg ? ' ' + msg : ''}`)
}

// ── 世界：只给需要的器官读数，其余留空 ─────────────────────
function world({
  t1 = T0, dt = MIN, events = [], amy = {}, ins = {}, hyp = {}, nm = {}, pfc = {},
  att = {}, social = {}, hipState = null, mood = 0, scene = 'home', activity = '', emotions = [],
} = {}) {
  const table = {
    amygdala: { threat: 0.05, rewardPE: 0, salience: 0.5, kind: 'neutral', cue: '', ...amy },
    insula: { felt: { intensity: 0.45 }, ...ins },
    hypothalamus: { hpa: { cortisol: 0.15 }, hormones: { oxytocin: 0.3 }, aggression: 0.1, ...hyp },
    neuromod: {
      ach: 0.4, ne: 0.3, oxytocin: 0.3, impulsivity: 0.25, trustThreshold: 0.62, gain: 1, ...nm,
    },
    pfc: { bandwidth: 0.6, ...pfc },
    attention: { focus: 0.3, ...att },
    social: { comfort: 0, ...social },
  }
  if (hipState) table.hippocampus = hipState
  return {
    tx: { t1, dtMs: dt, events, seed: 1 },
    mood, scene, activity, emotions,
    get: (id) => table[id] ?? null,
  }
}

// ── 带时钟的器官驱动：dt 按"上一次到这"的真实间隔算 ─────────
function runner(organ) {
  let t = T0
  const api = {
    organ,
    now: () => t,
    at(ms) { t = ms; return api },
    say(text, opts = {}) { return api.tick({ ...opts, text }) },
    idle(opts = {}) { return api.tick(opts) },
    tick(opts = {}) {
      const t1 = opts.t1 ?? t
      const dt = opts.dt ?? Math.max(0, t1 - t)
      t = t1
      const events = opts.text != null ? [{ type: 'user', text: opts.text, at: t1 }] : (opts.events ?? [])
      organ.step(world({ ...opts, t1, dt, events }))
      organ.commit()
      return organ.read()
    },
    snap() { return organ.snapshot() },
  }
  return api
}

const hip = () => runner(createHippocampus())
const mod = () => {
  const organ = createNeuromod()
  return {
    organ,
    step(opts = {}) { organ.step(world({ dt: 10 * MIN, ...opts })); return organ.read() },
    read() { return organ.read() },
  }
}

/** 引擎里把一个器官的读数字段钉死，看下游（fuse/注入）有没有跟着变 */
function engineRead({ id, key, value } = {}) {
  const e = createEngine({ now: () => T0 })
  if (id) {
    const m = e.organs[id]
    const orig = m.read.bind(m)
    m.read = () => ({ ...orig(), [key]: value })
  }
  e.tick([{ type: 'user', text: '今天还行，就是有点累', at: T0 }])
  return e.read()
}

// ── M01 情景编码：salience > 0.25 才写 ────────────────────
{
  const a = hip()
  const low = a.say('随便吧', { amy: { salience: 0.24, threat: 0.3, rewardPE: -0.3 } })
  const high = a.say('随便吧', { t1: T0 + MIN, amy: { salience: 0.26, threat: 0.3, rewardPE: -0.3 } })
  ok('M01', low.count === 0 && high.count === 1, `salience 0.24 不写（${low.count} 条）、0.26 写（${high.count} 条）`)
}

// ── M02 模式分离：相似 0.7 不合并 ──────────────────────────
{
  const a = hip()
  a.say('你不行', { amy: { salience: 0.9, threat: 0, rewardPE: 0.9 } })
  const far = a.say('你不行啊', { t1: T0 + 2 * MIN, amy: { salience: 0.9, threat: 0, rewardPE: -0.9 } })
  const b = hip()
  b.say('你不行', { amy: { salience: 0.9, threat: 0, rewardPE: 0.9 } })
  const near = b.say('你不行啊', { t1: T0 + 2 * MIN, amy: { salience: 0.9, threat: 0, rewardPE: 0.8 } })
  ok('M02', far.count === 2 && near.count === 1,
    `同 cue、感觉相反（相似度 0.70）留 ${far.count} 条；感觉只差一点（0.97）合并成 ${near.count} 条`)
}

// ── M03 模式完成：一点线索召回整条 ────────────────────────
{
  const a = hip()
  a.say('随便吧', { amy: { salience: 0.9, threat: 0.6, rewardPE: -0.6 }, emotions: [{ kind: '失望' }], scene: 'office' })
  const r = a.say('哦', { t1: T0 + 2 * MIN, amy: { salience: 0.08, threat: 0.3, rewardPE: -0.2 } })
  const hit = r.recall
  ok('M03', hit?.hit && hit.brief === '被冷淡地顶了一下' && hit.kind === '失望' && hit.scene === 'office' && hit.ageDays === 0,
    `只给一个"哦"，召回整条：${JSON.stringify(hit)}`)
}

// ── M04 时间编码：区分"上周"和"刚才" ──────────────────────
{
  const a = hip()
  a.say('随便吧', { amy: { salience: 0.9, threat: 0.7, rewardPE: -0.6 }, ins: { felt: { intensity: 0.9 } }, emotions: [{ kind: '难过' }] })
  const week = a.say('随便吧', { t1: T0 + 8 * DAY, amy: { salience: 0.08, threat: 0.6, rewardPE: -0.2 } })
  const b = hip()
  b.say('你不行', { amy: { salience: 0.9, threat: 0.7, rewardPE: -0.6 }, ins: { felt: { intensity: 0.9 } } })
  const just = b.say('你不行', { t1: T0 + 30_000, amy: { salience: 0.08, threat: 0.6, rewardPE: -0.2 } })
  ok('M04', week.recall?.ageDays === 8 && just.recall?.ageDays === 0,
    `八天前的事认成 ${week.recall?.ageDays} 天前，半分钟前的认成 ${just.recall?.ageDays} 天前`)
}

// ── M05 场景情境：只做场景标签 ────────────────────────────
{
  const a = hip()
  a.say('随便吧', { amy: { salience: 0.9, threat: 0.6, rewardPE: -0.6 }, scene: 'office' })
  const ep = a.snap().episodes[0]
  const r = a.say('哦', { t1: T0 + 2 * MIN, amy: { salience: 0.05, threat: 0.4, rewardPE: -0.2 } })
  const noPath = ep && !('path' in ep) && !('position' in ep) && !('map' in ep)
  ok('M05', ep?.scene === 'office' && r.recall?.scene === 'office' && noPath,
    `存的时候场景=${ep?.scene}，取的时候=${r.recall?.scene}；没有路径积分字段`)
}

// ── M06 巩固：夜间强度降 20%（同一个晚上只降一次）──────────
{
  const a = hip()
  const t0200 = new Date('2026-11-12T02:00:00+08:00').getTime()
  a.at(t0200)
  a.say('随便吧', { amy: { salience: 0.9, threat: 0.6, rewardPE: -0.6 }, ins: { felt: { intensity: 0.9 } } })
  const i0 = a.snap().episodes[0].intensity
  a.idle({ t1: t0200 + 30 * MIN })
  const i1 = a.snap().episodes[0].intensity
  a.idle({ t1: t0200 + 62 * MIN })     // 03:02 跨过凌晨三点
  const i2 = a.snap().episodes[0].intensity
  a.idle({ t1: t0200 + 92 * MIN })     // 03:32 同一晚，不该再降一次
  const i3 = a.snap().episodes[0].intensity
  const early = (i0 - i1) / i0
  const night = (i1 - i2) / i1
  const again = (i2 - i3) / i2
  ok('M06', early < 0.05 && night >= 0.15 && again < 0.05,
    `跨 03:00 降 ${(night * 100).toFixed(1)}%（之前 ${(early * 100).toFixed(1)}%，同一晚再来 ${(again * 100).toFixed(1)}%）`)
}

// ── M07 再巩固：提取后改写并记录，最多 5 次 ────────────────
{
  const a = hip()
  a.say('你不行', { amy: { salience: 0.9, threat: 0, rewardPE: 1.0 }, ins: { felt: { intensity: 0.8 } } })
  const v0 = a.snap().episodes[0].valence
  a.say('你不行', { t1: T0 + 2 * MIN, amy: { salience: 0.9, threat: 0.9, rewardPE: 0 }, mood: -0.8 })
  const once = a.snap().episodes[0]
  for (let i = 0; i < 8; i++) {
    a.say('你不行', { t1: a.now() + 2 * MIN, amy: { salience: 0.9, threat: 0.9, rewardPE: 0 }, mood: -0.8 })
  }
  const after = a.snap().episodes[0]
  ok('M07', once.reconsolidations === 1 && after.valence < v0 - 0.05 && after.reconsolidations <= 5,
    `提取一次 valence ${v0.toFixed(2)}→${after.valence.toFixed(2)}，reconsolidations=${once.reconsolidations}→${after.reconsolidations}（封顶 5）`)
}

// ── M08 提取：心情差时负性命中高 ≥40% ─────────────────────
{
  // 同家族不同 cue，避免被 M02 的合并吃掉；两条负、两条正
  const pool = () => {
    const a = hip()
    a.say('随便吧', { amy: { salience: 0.9, threat: 0.6, rewardPE: -0.9 } })   // 冷，-1.00
    a.say('你不行', { t1: T0 + MIN, amy: { salience: 0.9, threat: 0.3, rewardPE: -0.14 } }) // 否定，-0.35
    a.say('快走', { t1: T0 + 2 * MIN, amy: { salience: 0.9, threat: 0, rewardPE: 0.3 } })   // 命令，+0.30
    a.say('随便吧好吗', { t1: T0 + 3 * MIN, amy: { salience: 0.9, threat: 0, rewardPE: 0.85 } }) // 冷，+0.85
    return a
  }
  const share = (mood, threat, reward) => {
    let neg = 0
    for (let i = 0; i < 5; i++) {
      const a = pool()
      const r = a.say('随便吧', { t1: T0 + 10 * MIN, amy: { salience: 0.85, threat, rewardPE: reward }, mood })
      if (r.recall?.hit && Number(r.recall.valence) < 0) neg += 1
    }
    return neg / 5
  }
  const sad = share(-0.8, 0.85, 0)
  const glad = share(0.8, 0.05, 0.9)
  ok('M08', sad >= 0.4 && sad > glad,
    `心情差时负性命中 ${(sad * 100).toFixed(0)}%（≥40%）；心情好时只有 ${(glad * 100).toFixed(0)}%`)
}

// ── M09 应激抑制提取：皮质醇 >0.6 只回 1 条 ────────────────
{
  const pool = () => {
    const a = hip()
    a.say('随便吧', { amy: { salience: 0.9, threat: 0.6, rewardPE: -0.9 } })
    a.say('你不行', { t1: T0 + MIN, amy: { salience: 0.9, threat: 0.3, rewardPE: -0.14 } })
    a.say('快走', { t1: T0 + 2 * MIN, amy: { salience: 0.9, threat: 0, rewardPE: 0.3 } })
    return a
  }
  const calm = pool().say('随便吧', {
    t1: T0 + 10 * MIN, amy: { salience: 0.4, threat: 0.3, rewardPE: -0.2 }, hyp: { hpa: { cortisol: 0.2 } }, mood: -0.6,
  })
  const stressed = pool().say('随便吧', {
    t1: T0 + 10 * MIN, amy: { salience: 0.4, threat: 0.3, rewardPE: -0.2 }, hyp: { hpa: { cortisol: 0.75 } }, mood: -0.6,
  })
  ok('M09', (calm.recall?.hits ?? 0) >= 2 && stressed.recall?.hits === 1,
    `皮质醇 0.2 想起 ${calm.recall?.hits} 条，0.75 时压到 ${stressed.recall?.hits} 条`)
}

// ── M10 应激增强编码：高应激保留期 ×1.5 ───────────────────
{
  const low = hip()
  low.say('随便吧', { amy: { salience: 0.5, threat: 0.4, rewardPE: -0.3 }, hyp: { hpa: { cortisol: 0.2 } } })
  const high = hip()
  high.say('随便吧', { amy: { salience: 0.5, threat: 0.4, rewardPE: -0.3 }, hyp: { hpa: { cortisol: 0.7 } } })
  const a = low.snap().episodes[0].salience
  const b = high.snap().episodes[0].salience
  ok('M10', b / a > 1.4 && b / a < 1.6, `同一条事：应激 0.2 存 ${a.toFixed(2)}，应激 0.7 存 ${b.toFixed(2)}（×${(b / a).toFixed(2)}）`)
}

// ── M11 未来模拟：能生成没发生的担忧 ──────────────────────
{
  const a = hip()
  const worried = a.say('在吗', { amy: { salience: 0.2, threat: 0.75 }, pfc: { bandwidth: 0.3 } })
  const b = hip()
  const calm = b.say('在吗', { amy: { salience: 0.2, threat: 0.2 }, pfc: { bandwidth: 0.7 } })
  ok('M11', !!worried.recall?.worry && !calm.recall?.worry,
    `威胁高带宽低时想起"${worried.recall?.worry}"；平静时没有`)
}

// ── M12 社会记忆：记住对方的雷区 ──────────────────────────
{
  const a = hip()
  a.say('别提我妈了', { amy: { salience: 0.9, threat: 0.6, rewardPE: -0.5 } })
  const r = a.say('你妈最近怎么样', { t1: T0 + 5 * MIN, amy: { salience: 0.2, threat: 0.1 } })
  const mines = r.persons['他']?.landmines ?? []
  ok('M12', mines.includes('妈') && r.landmine === '妈',
    `记下雷区 ${JSON.stringify(mines)}；之后再提到就认出来（landmine=${r.landmine}）`)
}

// ── M13 图式：同类 3 次生成规则 ───────────────────────────
{
  const a = hip()
  a.say('你不行', { amy: { salience: 0.9, threat: 0.6, rewardPE: -0.9 } })
  a.say('你不行啊', { t1: T0 + MIN, amy: { salience: 0.9, threat: 0.4, rewardPE: -0.1 } })
  a.say('你不行呢', { t1: T0 + 2 * MIN, amy: { salience: 0.9, threat: 0, rewardPE: 0.5 } })
  const r = a.idle({ t1: T0 + 3 * MIN })
  const rule = r.schemas.find(x => x.cue === '否定')
  ok('M13', !!rule && rule.confidence >= 0.6,
    `同类第 3 次之后生出规则："${rule?.rule}"（置信 ${rule?.confidence?.toFixed(2)}）`)
}

// ── M14 遗忘曲线：30 天后低强度 <0.3 ──────────────────────
{
  const a = hip()
  a.say('随便吧', { amy: { salience: 0.9, threat: 0.6, rewardPE: -0.6 }, ins: { felt: { intensity: 0.5 } } })
  const i0 = a.snap().episodes[0].intensity
  a.idle({ t1: T0 + DAY })
  const i1 = a.snap().episodes[0].intensity
  a.idle({ t1: T0 + 30 * DAY })
  const ep = a.snap().episodes[0]
  const i2 = ep?.intensity ?? 0
  const canRecall = a.say('随便吧', { t1: T0 + 30 * DAY + MIN, amy: { salience: 0.05, threat: 0.5, rewardPE: 0 } })
  ok('M14', i0 > 0.4 && i1 > 0.3 && i2 < 0.3 && !canRecall.recall?.hit,
    `刚存 ${i0.toFixed(2)} → 一天后 ${i1.toFixed(2)} → 三十天后 ${i2.toFixed(2)}（<0.3，已经想不起来）`)
}

// ── M15 情境恐惧：场景命中，恐惧回升 ──────────────────────
{
  const hitRun = (queryScene) => {
    const a = hip()
    a.say('随便吧', { amy: { salience: 0.9, threat: 0.7, rewardPE: -0.6 }, scene: 'office' })
    return a.say('哦', {
      t1: T0 + 2 * MIN, amy: { salience: 0.05, threat: 0.5, rewardPE: -0.2 }, scene: queryScene,
    })
  }
  const sameScene = hitRun('office')
  const otherScene = hitRun('home')
  // 喂给杏仁核：反应之后的威胁该更高
  const amygdalaThreat = (reactivate) => {
    const amy = createAmygdala()
    amy.step({ tx: { dtMs: MIN, t1: T0 }, prevGain: 0.5, scene: 'office', get: (id) => (id === 'hippocampus' ? { reactivate } : null) })
    return amy.read().threat
  }
  const tSame = amygdalaThreat(sameScene.reactivate)
  const tOther = amygdalaThreat(otherScene.reactivate)
  ok('M15', sameScene.reactivate > otherScene.reactivate + 0.1 && tSame > tOther,
    `场景对得上 reactivate=${sameScene.reactivate.toFixed(2)}（威胁 ${tSame.toFixed(3)}）；对不上 ${otherScene.reactivate.toFixed(2)}（威胁 ${tOther.toFixed(3)}）`)
}

// ── M16 睡眠再加工：隔夜强度降 ≥15% ───────────────────────
{
  const drop = (t0, t1) => {
    const a = hip()
    a.at(t0)
    a.say('随便吧', { amy: { salience: 0.9, threat: 0.6, rewardPE: -0.6 }, ins: { felt: { intensity: 0.8 } } })
    const before = a.snap().episodes[0].intensity
    a.idle({ t1 })
    return 1 - a.snap().episodes[0].intensity / before
  }
  const night = drop(new Date('2026-11-12T22:00:00+08:00').getTime(), new Date('2026-11-13T09:00:00+08:00').getTime())
  const awake = drop(new Date('2026-11-12T10:00:00+08:00').getTime(), new Date('2026-11-12T21:00:00+08:00').getTime())
  ok('M16', night >= 0.15 && awake < 0.05,
    `隔着同样的 11 小时：睡觉降 ${(night * 100).toFixed(1)}%（≥15%），清醒只降 ${(awake * 100).toFixed(1)}%`)
}

// ── M17 怀旧：听歌看照片触发 ──────────────────────────────
{
  const a = hip()
  a.at(T0 - 10 * DAY)
  a.say('你真好', { amy: { salience: 0.9, threat: 0, rewardPE: 0.9 }, ins: { felt: { intensity: 0.9 } } })
  const r = a.say('听到这首歌，突然想起以前', { t1: T0, amy: { salience: 0.6, threat: 0.1, rewardPE: 0.3 } })
  const b = hip()
  b.at(T0 - 10 * DAY)
  b.say('你真好', { amy: { salience: 0.9, threat: 0, rewardPE: 0.9 }, ins: { felt: { intensity: 0.9 } } })
  const plain = b.say('今天吃什么', { t1: T0, amy: { salience: 0.6, threat: 0.1, rewardPE: 0.3 } })
  ok('M17', r.nostalgia > 0.35 && plain.nostalgia === 0,
    `听歌碰到十天前的正面记忆，nostalgia=${r.nostalgia.toFixed(2)}；平白聊天=${plain.nostalgia}`)
}

// ── M18 记忆失真：细节可错、情绪方向不变 ──────────────────
{
  const a = hip()
  a.say('随便吧', { amy: { salience: 0.9, threat: 0.7, rewardPE: -0.6 }, scene: 'office' })
  const v0 = Math.sign(a.snap().episodes[0].valence)
  let last = null
  for (let i = 0; i < 5; i++) {
    last = a.say('随便吧', { t1: T0 + (i + 1) * 2 * MIN, amy: { salience: 0.9, threat: 0.9, rewardPE: 0 }, mood: -0.6 })
  }
  const ep = a.snap().episodes[0]
  ok('M18', ep.distortion >= 3 && ep.sceneClaimed === 'home' && last.recall?.scene === 'home' && Math.sign(last.recall.valence) === v0,
    `想起 5 次后场景记岔成 ${last.recall?.scene}（原 office），情绪方向 ${v0} → ${Math.sign(last.recall.valence)} 没翻`)
}

// ── T01 去甲肾上腺素：高 NE 阈值下调 ──────────────────────
{
  const low = hip()
  low.say('随便吧', { amy: { salience: 0.21, threat: 0.2 }, nm: { ne: 0.1 } })
  const high = hip()
  high.say('随便吧', { amy: { salience: 0.21, threat: 0.2 }, nm: { ne: 0.9 } })
  ok('T01', low.organ.read().count === 0 && high.organ.read().count === 1,
    `同一条 0.21 的事：NE 0.1 不写（${low.organ.read().count} 条），NE 0.9 写进去（${high.organ.read().count} 条）`)
}

// ── T02 多巴胺：期待落空低于基线 ──────────────────────────
{
  const n = mod()
  const lose = n.step({ amy: { rewardPE: -0.7, threat: 0.1 } }).da
  const neutral = n.step({ amy: { rewardPE: 0, threat: 0.1 } }).da
  const win = n.step({ amy: { rewardPE: 0.7, threat: 0.1 } }).da
  ok('T02', lose < 0.5 && Math.abs(neutral - 0.5) < 0.05 && win > 0.5,
    `落空 da=${lose.toFixed(2)}（低于基线 0.5）、回到中性 ${neutral.toFixed(2)}、如愿 ${win.toFixed(2)}`)
}

// ── T03 血清素：低 5-HT 冲动上升（检索门跟着松）───────────
{
  const angry = mod()
  for (let i = 0; i < 12; i++) angry.step({ amy: { threat: 0.85, rewardPE: -0.4 } })
  const calm = mod()
  for (let i = 0; i < 12; i++) calm.step({ amy: { threat: 0.05, rewardPE: 0.5 } })
  const a = angry.read()
  const c = calm.read()
  // 行为：同一条已经淡了的旧事，冲动时翻得出来、审慎时翻不出来
  const recallHits = (nm) => {
    const h = hip()
    h.say('随便吧', { amy: { salience: 0.5, threat: 0.6, rewardPE: -0.6 }, ins: { felt: { intensity: 0.65 } } })
    h.idle({ t1: T0 + 12 * DAY })
    const r = h.say('哦', { t1: T0 + 12 * DAY + MIN, amy: { salience: 0.05, threat: 0.5, rewardPE: -0.4 }, mood: -0.5, nm })
    return r.recall?.hits ?? 0
  }
  const impulsiveHits = recallHits(a)
  const carefulHits = recallHits(c)
  ok('T03', a.impulsivity > 0.4 && c.impulsivity < 0.3 && impulsiveHits > carefulHits,
    `连挨怼 12 拍：5-HT ${a.serotonin.toFixed(2)} → 冲动 ${a.impulsivity.toFixed(2)}，旧事翻出 ${impulsiveHits} 条；平静时冲动 ${c.impulsivity.toFixed(2)}，翻出 ${carefulHits} 条`)
}

// ── T04 乙酰胆碱：高 ACh 编码更深 ─────────────────────────
{
  const achOf = (focus) => {
    const n = mod()
    for (let i = 0; i < 40; i++) n.step({ att: { focus } })
    return n.read()
  }
  const high = achOf(0.95)
  const low = achOf(0.05)
  const encodeWith = (nm) => {
    const h = hip()
    h.say('你不行', { amy: { salience: 0.9, threat: 0.5, rewardPE: -0.5 }, ins: { felt: { intensity: 0.5 } }, nm })
    return h.snap().episodes[0]
  }
  const deep = encodeWith(high)
  const shallow = encodeWith(low)
  ok('T04', high.ach >= 0.6 && low.ach <= 0.45 && deep.depth === 'deep' && shallow.depth === 'normal' && deep.salience > shallow.salience,
    `专注 40 拍 ACh ${low.ach.toFixed(2)}→${high.ach.toFixed(2)}；同一条事记成 ${shallow.depth}/${deep.depth}，强度 ${shallow.salience.toFixed(2)}→${deep.salience.toFixed(2)}`)
}

// ── T05 催产素：亲密后信任阈值降 ──────────────────────────
{
  const oxyOf = (hormone) => {
    const n = mod()
    for (let i = 0; i < 40; i++) n.step({ hyp: { hormones: { oxytocin: hormone } } })
    return n.read()
  }
  const close = oxyOf(0.85)
  const distant = oxyOf(0.25)
  const warm = (nm) => {
    const h = hip()
    h.say('你真好', { amy: { salience: 0.9, threat: 0, rewardPE: 0.8 }, nm })
    return h.snap().episodes[0]
  }
  const intimate = warm(close)
  const polite = warm(distant)
  ok('T05', distant.trustThreshold - close.trustThreshold >= 0.15 && intimate.intimate === true && polite.intimate === false,
    `亲密后信任门槛 ${distant.trustThreshold.toFixed(2)}→${close.trustThreshold.toFixed(2)}；同一句暖话记成 intimate=${polite.intimate}→${intimate.intimate}`)
}

// ── T06 加压素：被冒犯攻击性升 ────────────────────────────
{
  const offended = mod()
  const v1 = offended.step({ dt: MIN, amy: { threat: 0.85 }, hyp: { aggression: 0.7 } }).vasopressin
  const calm = mod()
  const v0 = calm.step({ dt: MIN, amy: { threat: 0.05 }, hyp: { aggression: 0.2 } }).vasopressin
  // 雷区额外一档
  const mine = mod()
  const v2 = mine.step({ dt: MIN, amy: { threat: 0.05 }, hyp: { aggression: 0.2 }, hipState: { landmine: '妈' } }).vasopressin
  // 下游：加压素越高，评价里的"对方占了上风"越重
  const lowV = engineRead({ id: 'neuromod', key: 'vasopressin', value: 0.2 })
  const highV = engineRead({ id: 'neuromod', key: 'vasopressin', value: 0.9 })
  ok('T06', v1 > v0 + 0.1 && v2 > v0 && highV.appraisal.agencyOther < lowV.appraisal.agencyOther,
    `被冒犯 vasopressin ${v0.toFixed(2)}→${v1.toFixed(2)}；踩到雷区 ${v2.toFixed(2)}；下游 agencyOther ${lowV.appraisal.agencyOther.toFixed(2)}→${highV.appraisal.agencyOther.toFixed(2)}`)
}

// ── T07 内源性阿片：被安抚痛感降 ──────────────────────────
{
  const soothed = mod()
  for (let i = 0; i < 3; i++) soothed.step({ social: { comfort: 0.8 } })
  const alone = mod()
  for (let i = 0; i < 3; i++) alone.step({ social: { comfort: 0 } })
  const op = soothed.read().opioid
  const noOp = alone.read().opioid
  const lowOp = engineRead({ id: 'neuromod', key: 'opioid', value: 0.2 })
  const highOp = engineRead({ id: 'neuromod', key: 'opioid', value: 0.9 })
  ok('T07', op > noOp + 0.2 && highOp.appraisal.coping > lowOp.appraisal.coping,
    `被安抚 opioid ${noOp.toFixed(2)}→${op.toFixed(2)}；下游 coping ${lowOp.appraisal.coping.toFixed(2)}→${highOp.appraisal.coping.toFixed(2)}（更扛得住）`)
}

// ── T08 内源性大麻素：运动后紧绷降 ────────────────────────
{
  const sport = mod()
  for (let i = 0; i < 3; i++) sport.step({ activity: 'sport' })
  const rest = mod()
  for (let i = 0; i < 3; i++) rest.step({})
  const endo = sport.read().endocannabinoid
  const noEndo = rest.read().endocannabinoid
  const lowEndo = engineRead({ id: 'neuromod', key: 'endocannabinoid', value: 0.15 })
  const highEndo = engineRead({ id: 'neuromod', key: 'endocannabinoid', value: 0.9 })
  ok('T08', endo > noEndo + 0.3 && highEndo.appraisal.coping > lowEndo.appraisal.coping,
    `动完 endocannabinoid ${noEndo.toFixed(2)}→${endo.toFixed(2)}；下游 coping ${lowEndo.appraisal.coping.toFixed(2)}→${highEndo.appraisal.coping.toFixed(2)}`)
}

// ── 汇总 ────────────────────────────────────────────────
const total = results.length
const failed = results.filter(r => !r.pass)
console.log('')
console.log(`断言 ${total} 条，失败 ${failed.length} 条`)
if (failed.length) {
  console.log(`失败项：${failed.map(r => r.id).join(', ')}`)
  console.log('FAIL')
} else {
  console.log('PASS')
}
process.exit(failed.length ? 1 : 0)
