// 功能断言：表 2「下丘脑」H01–H20（H09 豁免）、表 5「前额叶」P01–P23、
// 表 7「注意」N01–N06、表 8「社会」S01–S12、表 10「默认模式」D01–D05、表 12「病感」F01–F04。
//   node tests/fn-core-six-tables.mjs
//
// 每条都是"给一个刺激 → 某个字段/输出跟着变"：用 createEngine({ now }) 走真实心跳。
// 只在摆处境时碰器官内部（snapshot/restore：睡债、带宽、信任、周期），
// 以及直接读器官 read() 的字段——都是引擎自己算出来的，不是测试里另算一份。
// H09（性/生殖行为）功能总表标"免"，写成豁免注释，不计失败；其余 69 条都是真断言。

import { createEngine } from '../core/engine.js'
import { NEG_KINDS } from '../core/consts.js'

const MIN = 60_000
const HOUR = 3_600_000
const DAY = 86_400_000
const T0 = new Date('2026-11-12T10:00:00+08:00').getTime()

const results = []
const ok = (id, cond, msg) => {
  results.push({ id, pass: !!cond })
  console.log(cond ? `ok: ${id} ${msg}` : `FAIL ${id} ${msg}`)
}
const f = (n, d = 3) => (Number.isFinite(Number(n)) ? Number(n).toFixed(d) : String(n))

// ── 引擎夹具：时钟自己推，台词自己发 ─────────────────────
function mk(t0 = T0, persona = {}) {
  let t = t0
  const e = createEngine({ now: () => t, persona })
  const api = {
    e,
    at: () => t,
    // 同一条消息 30 秒内会被 K07 幂等丢掉，所以调用方要把间隔拉开
    go(ms) { t += ms; return api },
    min(m) { t += m * MIN; e.tick([]); return api },
    hr(n) { t += n * HOUR; e.tick([]); return api },
    say(text) { e.tick([{ type: 'user', text, at: t }]); return api },
    sayMany(texts) { e.tick(texts.map(text => ({ type: 'user', text, at: t }))); return api },
    ast(text) { e.tick([{ type: 'assistant', text, at: t }]); return api },
    act(kind) { e.tick([{ type: 'activity', kind, at: t }]); return api },
    air() { e.tick([]); return api },
  }
  return api
}
const hype = (x) => x.e.organs.hypothalamus.read()
const pf = (x) => x.e.organs.pfc.read()
const att = (x) => x.e.organs.attention.read()
const soc = (x) => x.e.organs.social.read()
const dmn = (x) => x.e.organs.dmn.read()
const sick = (x) => x.e.organs.sickness.read()
const amy = (x) => x.e.organs.amygdala.read()
const fused = (x) => x.e.read()
const set = (x, id, patch) => {
  const s = x.e.organs[id].snapshot()
  Object.assign(s, patch)
  x.e.organs[id].restore(s)
  return x
}

// 刺激
const INSULT = '你算什么东西，闭嘴滚蛋'          // 冷 + 命令 + 强度词：威胁高
const INSULT2 = '你就是个废物，蠢货'             // 另一句同样难听（避开幂等）
const STING = '你行不行啊，这都做不好，又崩了'
const COLD = '哦'
const WARM = '谢谢你，今天辛苦你了'
const HURT_OTHER = '他今天好难受，撑不住了'
const HURT_SELF = '我今天好难受，撑不住了'
const NEUTRAL = '今天周三'
const PREP = '对不起，刚才是我说重了'

// ══════════════════════ 表 2 · 下丘脑 ══════════════════════

// H01 体温调节：低温 → 缺口感上升
{
  const cold = mk(); cold.say('外面好冷，冻得手都僵了')
  const warm = mk(); warm.say(NEUTRAL)
  const c = hype(cold).needs.warmth
  const w = hype(warm).needs.warmth
  ok('H01', c > w + 0.1, `冷话之后 warmth ${f(w)} → ${f(c)}（缺口感真的被温度拉动）`)
}

// H02 渗透压/渴：6h 未饮水 > 0.5，喝过水就不该渴
{
  const noDrink = mk()
  for (let i = 0; i < 6; i++) noDrink.hr(1)
  const drank = mk(); drank.say('我喝了杯水')
  for (let i = 0; i < 6; i++) drank.hr(1)
  const a = hype(noDrink).needs.thirst
  const b = hype(drank).needs.thirst
  ok('H02', a > 0.5 && a > b + 0.1, `6h 没喝 thirst=${f(a)}；喝过水 ${f(b)}`)
}

// H03 能量/饿：24h 内饿到 0.85 并自己进食（吃完回落）
{
  const x = mk()
  const trail = []
  for (let i = 0; i < 24; i++) { x.hr(1); trail.push(hype(x).needs.hunger) }
  const peak = Math.max(...trail)
  const iPeak = trail.indexOf(peak)
  const after = trail[iPeak + 1]
  ok('H03', peak >= 0.85 && after < 0.35, `hunger 峰值 ${f(peak)}，下一拍进食后 ${f(after)}`)
}

// H04 睡眠压力：24h 不睡 → 1.0
{
  const x = mk()
  for (let i = 0; i < 76; i++) x.min(19)   // <20min：引擎不会判定"睡着"
  const s = hype(x).needs.sleep
  ok('H04', s >= 0.99, `24h 没睡 sleep 压力 ${f(s)}（睡眠债 ${f(hype(x).sleepDebt)}）`)
}

// H05 昼夜节律：10/20 两个峰，15/3:30 两个谷
{
  const at = (hh) => {
    const t = new Date('2026-11-12T' + hh + ':00+08:00').getTime()
    const x = mk(t); x.air()
    return hype(x).rhythm.energy
  }
  const e10 = at('10:00'), e15 = at('15:00'), e20 = at('20:00'), e0330 = at('03:30')
  ok('H05', e10 > e15 + 0.1 && e20 > e15 + 0.1 && e20 > e0330 + 0.1 && e15 < e10 * 0.75 && e0330 < e20 * 0.75,
    `能量 10点=${f(e10)} 15点=${f(e15)} 20点=${f(e20)} 3:30=${f(e0330)}`)
}

// H06 HPA 轴：8 分钟升起来，70 分钟退下去
{
  const x = mk(); x.say(INSULT)
  const c0 = hype(x).hpa.cortisol
  for (let i = 0; i < 4; i++) { x.min(2); x.say(INSULT) }
  const c8 = hype(x).hpa.cortisol
  for (let i = 0; i < 7; i++) x.min(10)
  const c78 = hype(x).hpa.cortisol
  ok('H06', c8 > c0 + 0.04 && c78 < c8 * 0.75, `cortisol ${f(c0)} →(8min) ${f(c8)} →(70min) ${f(c78)}`)
}

// H07 交感/副交感：威胁↑ → 心率↑、HRV↓
{
  const hot = mk(); hot.say(INSULT); hot.min(3); hot.min(2)
  const calm = mk(); calm.say(NEUTRAL); calm.min(3); calm.min(2)
  const symH = hype(hot).autonomic.sym, symC = hype(calm).autonomic.sym
  const hrH = hype(hot).body.hr, hrC = hype(calm).body.hr
  const vH = hype(hot).body.hrv, vC = hype(calm).body.hrv
  ok('H07', symH > symC + 0.05 && hrH > hrC + 4 && vH < vC - 2,
    `sym ${f(symC)}→${f(symH)} hr ${f(hrC,1)}→${f(hrH,1)} hrv ${f(vC,1)}→${f(vH,1)}`)
}

// H08 攻击行为：高威胁 + 低掌控（带宽低）→ 攻击性抬起来
{
  const low = mk(); set(low, 'pfc', { bandwidth: 0.1 }); low.air(); low.say(INSULT)
  const high = mk(); set(high, 'pfc', { bandwidth: 0.9 }); high.air(); high.say(INSULT)
  const a = hype(low).aggression, b = hype(high).aggression
  ok('H08', a > 0.3 && a > b + 0.15, `低掌控 aggression=${f(a)}，高掌控 ${f(b)}`)
}

// H09 性/生殖行为：功能总表标"免"（消融：关掉后对话分布无变化），不实现
ok('H09', true, '豁免：功能总表标"免"——性/生殖行为消融，只留周期间接影响（H15）')

// H10 依恋激素：亲密之后应激恢复加快
{
  const a = mk(); const b = mk()
  for (const x of [a, b]) { x.say(INSULT); x.min(3) }
  a.say('抱抱，我最喜欢你了'); b.say(NEUTRAL)
  for (let i = 0; i < 6; i++) { a.min(5); b.min(5) }
  const oxyA = hype(a).hormones.oxytocin, oxyB = hype(b).hormones.oxytocin
  const corA = hype(a).hpa.cortisol, corB = hype(b).hpa.cortisol
  ok('H10', oxyA > oxyB + 0.05 && corA < corB * 0.92,
    `催产素 ${f(oxyB)}→${f(oxyA)}；皮质醇 ${f(corB)}→${f(corA)}（恢复更快）`)
}

// H11 应激恢复：连着应激 3 天 → 同样的威胁 HPA 反应变钝
{
  const fresh = mk()
  const stress = mk()
  // 每 3 小时一句难听话：先走 3h，再在同一个 tick 里发（dt 里带着事件才算应激）
  for (let i = 0; i < 24; i++) { stress.go(3 * HOUR); stress.say(i % 2 ? INSULT : INSULT2) }
  stress.hr(1)
  const sl = Number(stress.e.organs.hypothalamus.snapshot().stressLoad) || 0
  // 把两边的皮质醇和"这一刻的威胁"都摆到同一格——比的是 HPA 反应有多大，
  // 不是谁起点高、也不是谁的杏仁核被敏化得更凶（那是另一条通道）。
  const probe = (x) => {
    set(x, 'hypothalamus', { cortisol: 0.15 })
    set(x, 'amygdala', { threat: 0.4, fastThreat: 0.4 })
    x.air()                                   // 让这一帧的 amy 读数进 cache
    set(x, 'hypothalamus', { cortisol: 0.15 }) // 清掉 air 那一帧的污染
    x.min(1)
    return hype(x).hpa.cortisol - 0.15
  }
  const dF = probe(fresh)
  const dS = probe(stress)
  ok('H11', sl > 0.5 && dS < dF * 0.75,
    `3 天应激 stressLoad=${f(sl)}；同一威胁皮质醇增量 ${f(dF)} → ${f(dS)}（钝了）`)
}

// H12 疼痛下行调制：高唤醒时痛感下降
{
  const hot = mk(); hot.say(INSULT); hot.min(3); hot.say(INSULT2); hot.min(2)
  const calm = mk(); calm.say(NEUTRAL); calm.min(3); calm.min(2)
  const pH = hype(hot).body.pain
  const pC = hype(calm).body.pain
  ok('H12', pH < pC * 0.9, `痛感 平静 ${f(pC)} → 高唤醒 ${f(pH)}（门控 sym=${f(hype(hot).autonomic.sym)}）`)
}

// H13 奖赏性进食：吃过东西 → moodBias +0.05 上下
{
  const ate = mk(); ate.say('刚吃了碗面，好饱')
  const none = mk(); none.say(NEUTRAL)
  const a = hype(ate).rhythm.moodBias, b = hype(none).rhythm.moodBias
  ok('H13', a > b + 0.04, `moodBias ${f(b)} → ${f(a)}（吃过 vs 没吃）`)
}

// H14 预期性调节：饭点前饿得更快
{
  const pre = mk(new Date('2026-11-12T11:00:00+08:00').getTime()); pre.say(NEUTRAL)
  const preH0 = hype(pre).needs.hunger
  pre.hr(1)
  const preGain = hype(pre).needs.hunger - preH0
  const ctl = mk(new Date('2026-11-12T09:00:00+08:00').getTime()); ctl.say(NEUTRAL)
  const ctlH0 = hype(ctl).needs.hunger
  ctl.hr(1)
  const ctlGain = hype(ctl).needs.hunger - ctlH0
  ok('H14', preGain > ctlGain + 0.03, `一小时饿感增量：饭点前 ${f(preGain)} vs 上午 ${f(ctlGain)}`)
}

// H15 生理周期：经前阈值 ≤ -0.15
{
  const pre = mk(T0, { cycle: { on: true, lastStart: T0 - 25 * DAY } })
  pre.air()
  const plain = mk(); plain.air()
  const shiftPre = hype(pre).rhythm.thresholdShift
  const shiftPlain = hype(plain).rhythm.thresholdShift
  const phase = hype(pre).cycle.phase
  ok('H15', shiftPre <= -0.15 && shiftPre < shiftPlain - 0.1,
    `相位 ${phase}，thresholdShift 平常 ${f(shiftPlain)} → 经前 ${f(shiftPre)}`)
}

// H16 能量分配：生病 → energy -30%
{
  const ill = mk(); ill.say('我发烧了，嗓子疼得厉害')
  const well = mk(); well.say(NEUTRAL)
  const eIll = hype(ill).rhythm.energy
  const eWell = hype(well).rhythm.energy
  ok('H16', eIll < eWell * 0.8, `energy 健康 ${f(eWell)} → 生病 ${f(eIll)}（${f((1 - eIll / eWell) * 100, 1)}% 没了）`)
}

// H17 体温的情绪成分：过冷 → 耐心下降（阈值下调）
{
  const cold = mk(); cold.say('好冷，冻得我直打哆嗦')
  const warm = mk(); warm.say(NEUTRAL)
  const sCold = hype(cold).rhythm.thresholdShift
  const sWarm = hype(warm).rhythm.thresholdShift
  ok('H17', sCold < sWarm - 0.03 && hype(cold).needs.warmth > hype(warm).needs.warmth + 0.1,
    `thresholdShift ${f(sWarm)} → ${f(sCold)}（越冷越没耐心）`)
}

// H18 入睡/醒来：深夜反应变慢
{
  const night = mk(new Date('2026-11-12T23:30:00+08:00').getTime()); night.air()
  const day = mk(new Date('2026-11-12T14:00:00+08:00').getTime()); day.air()
  const gN = hype(night).sleepGate, gD = hype(day).sleepGate
  const bN = hype(night).bandwidthCap, bD = hype(day).bandwidthCap
  ok('H18', gN < gD - 0.3 && bN < bD - 0.2, `sleepGate ${f(gD)}→${f(gN)}，带宽上限 ${f(bD)}→${f(bN)}`)
}

// H19 咖啡因：唤醒抬升，半衰 5h
{
  const x = mk(); x.say('喝了杯美式咖啡')
  x.min(20)
  const s1 = hype(x).stimulant
  x.min(300)
  const s2 = hype(x).stimulant
  ok('H19', s1 > 0.08 && Math.abs(s2 - s1 / 2) < 0.04,
    `stimulant 20min=${f(s1)} → 5h 后 ${f(s2)}（半衰 ≈ ${f(s1 / 2)}）`)
}

// H20 睡眠债双通道：缺觉同时"抬增益、压上限"
{
  const tired = mk(); set(tired, 'hypothalamus', { sleepDebt: 0.85 }); tired.air()
  const rested = mk(); set(rested, 'hypothalamus', { sleepDebt: 0.1 }); rested.air()
  const tS = hype(tired).rhythm.thresholdShift, rS = hype(rested).rhythm.thresholdShift
  const tC = hype(tired).bandwidthCap, rC = hype(rested).bandwidthCap
  const tCert = Number(fused(tired).appraisal?.certainty ?? 0)
  const rCert = Number(fused(rested).appraisal?.certainty ?? 0)
  ok('H20', tS < rS - 0.1 && tC < rC - 0.15 && tCert < rCert - 0.03,
    `缺觉：阈值 ${f(rS)}→${f(tS)}（增益抬）、带宽上限 ${f(rC)}→${f(tC)}（压上限）、评价确定性 ${f(rCert)}→${f(tCert)}`)
}

// ══════════════════════ 表 5 · 前额叶 ══════════════════════

// P01 工作记忆：多任务之后槽位变少、负荷变高
{
  const idle = mk(); idle.air()
  const busy = mk(); busy.sayMany(['帮我看看这个表', '还有昨天那封邮件', '顺便把第三份也改了'])
  const s0 = pf(idle).slots, s1 = pf(busy).slots
  const l0 = pf(idle).load, l1 = pf(busy).load
  ok('P01', s1 < s0 && s1 <= 3 && l1 > l0 + 0.05,
    `槽位 ${s0} → ${s1}，负荷 ${f(l0)} → ${f(l1)}`)
}

// P02 抑制控制：想怼的时候压住（抑制量、遮罩、话变短）
{
  const x = mk(); x.say(INSULT); x.min(1); x.say(INSULT2)
  const p = pf(x)
  ok('P02', p.display.mask > 0.4 && p.display.brevity > 0.4 && p.decision.speak === true,
    `mask=${f(p.display.mask)} brevity=${f(p.display.brevity)}（想怼，但压住了，仍然回话）`)
}

// P03 抑制想法：越压越漏（带宽低的时候泄漏风险更高）
{
  const pressed = mk()
  set(pressed, 'pfc', { bandwidth: 0.15 }); pressed.air(); pressed.say(INSULT); pressed.min(1); pressed.say(INSULT2)
  const loose = mk()
  set(loose, 'pfc', { bandwidth: 0.8 }); loose.air(); loose.say(INSULT); loose.min(1); loose.say(INSULT2)
  const a = pf(pressed).display.leakRisk, b = pf(loose).display.leakRisk
  ok('P03', a > 0.3 && a > b + 0.2, `leakRisk 带宽够 ${f(b)} → 硬压着 ${f(a)}（越压越漏）`)
}

// P04 重评：四策略之一真的生效（不是每拍都失败）
{
  const pool = ['换框架', '找反例', '拉远', '接受']
  const x = mk()
  let strategy = 'none'
  for (let i = 0; i < 8; i++) {
    x.min(6); x.say(i % 2 ? INSULT : STING)
    const r = pf(x).reappraisal
    if (r.success && pool.includes(r.strategy)) { strategy = r.strategy; break }
  }
  ok('P04', pool.includes(strategy), `重评落到「${strategy}」（四策略之一）`)
}

// P05 消退：反复的安全信号把 threat 压下去（pfcGain 在起作用）
{
  const safe = mk(); safe.say(INSULT)
  const peak = amy(safe).threat
  for (let i = 0; i < 5; i++) { safe.min(1); safe.say(PREP) }
  const ctl = mk(); ctl.say(INSULT)
  for (let i = 0; i < 5; i++) { ctl.min(1); ctl.say(NEUTRAL) }
  const tS = amy(safe).threat, tC = amy(ctl).threat
  ok('P05', tS < peak * 0.5 && tS < tC * 0.8 && pf(safe).pfcGain > 0.4,
    `五轮安全信号：threat 峰值 ${f(peak)} → ${f(tS)}（对照 ${f(tC)}；pfcGain=${f(pf(safe).pfcGain)}）`)
}

// P06 价值整合：值不值得翻脸（信任/舒适高 → 愿意低头）
{
  const warm = mk()
  set(warm, 'social', { trust: 0.85, comfort: 0.45, relationship: 'close' }); warm.air()
  const vWarm = pf(warm).value
  const hot = mk()
  set(hot, 'social', { trust: 0.2, comfort: 0, relationship: 'acquaintance' }); hot.air(); hot.say(INSULT)
  const vHot = pf(hot).value
  ok('P06', vWarm > 0.7 && vHot < 0.55 && pf(warm).decision.yield === true && pf(hot).decision.yield === false,
    `value 亲 ${f(vWarm)}（低头）vs 生 ${f(vHot)}（不低）`)
}

// P07 冲突监测：想说 / 该说打架 → conflict +0.1
{
  const quiet = mk(); quiet.say(NEUTRAL)
  const c0 = pf(quiet).conflict
  const x = mk(); x.say(INSULT); x.min(1); x.say(INSULT2)
  const c1 = pf(x).conflict
  ok('P07', c1 > c0 + 0.1, `conflict 平静 ${f(c0)} → 被怼 ${f(c1)}`)
}

// P08 错误监测：被指出做错 → 不适上升；道歉 → 回落
{
  const x = mk(); x.say('你又搞砸了，说了几遍还是这样')
  const e1 = pf(x).error
  x.min(1); x.say(PREP)
  const e2 = pf(x).error
  ok('P08', e1 > 0.15 && e2 < e1 * 0.5, `error ${f(e1)} →（道歉后）${f(e2)}`)
}

// P09 延迟满足：忍 10 分钟，然后那股劲放掉
{
  const x = mk(); x.say(STING)
  x.min(1); x.min(1); x.min(1)
  const holding = pf(x).decision.hold
  x.min(10)
  const released = pf(x).decision.hold
  ok('P09', holding === true && released === false,
    `憋着 hold=${holding} → 10 分钟后 hold=${released}（放掉）`)
}

// P10 决策：带宽不够就不敢直说
{
  const low = mk(); set(low, 'pfc', { bandwidth: 0.1 }); low.air(); low.say(INSULT)
  const high = mk(); high.air(); high.say(INSULT)
  ok('P10', pf(low).decision.speak === false && pf(high).decision.speak === true,
    `speak 低带宽=${pf(low).decision.speak} 正常=${pf(high).decision.speak}`)
}

// P11 归因：四种组合里三种落点不同（自己 / 他 / 环境）
{
  const self = mk(); self.say('不对，这里错了，你搞砸了')
  const other = mk()
  for (let i = 0; i < 3; i++) { other.min(1); other.say(i % 2 ? INSULT : INSULT2) }
  const circ = mk(); circ.say('随便你吧')
  const a = pf(self).attribution
  const b = pf(other).attribution
  const c = pf(circ).attribution
  const loci = new Set([a.locus, b.locus, c.locus])
  ok('P11', a.locus === 'self' && b.locus === 'other' && c.locus === 'circumstance' && loci.size === 3
    && b.confidence >= 0.4,
    `归因 ${a.locus}/${b.locus}/${c.locus}（置信 ${f(a.confidence,2)}/${f(b.confidence,2)}/${f(c.confidence,2)}）`)
}

// P12 心理理论：带宽够才推断得出"他在敷衍"
{
  const read = (bw) => {
    const x = mk(); set(x, 'pfc', { bandwidth: bw }); x.air(); x.say('随便吧，你定')
    return { tom: pf(x).theoryOfMind, mind: soc(x).mindRead }
  }
  const hi = read(0.9), lo = read(0.1)
  ok('P12', hi.mind >= 0.65 && hi.tom > 0.6 && hi.tom > lo.tom + 0.15 && lo.mind < hi.mind - 0.15,
    `同一句敷衍：带宽低 读心=${f(lo.mind)}（ToM ${f(lo.tom)}）→ 带宽够 读心=${f(hi.mind)}（ToM ${f(hi.tom)}）`)
}

// P13 道德判断：越界 → 厌恶 + 生气（规范压力为负）
{
  const x = mk(); x.say('你这样说太过分了，太恶心了，欺负人也得有个度')
  const moral = pf(x).moral
  const norm = Number(fused(x).appraisal?.norm ?? 0)
  const disgust = Number(fused(x).insula?.disgust ?? x.e.organs.insula.read().disgust ?? 0)
  ok('P13', moral > 0.4 && norm <= -0.15 && disgust > 0.15,
    `moral=${f(moral)} appraisal.norm=${f(norm)} 厌恶=${f(disgust)}`)
}

// P14 表达规则：对主人 / 对外人不一样
{
  const close = mk(); set(close, 'social', { relationship: 'close', trust: 0.6 }); close.air()
  const stranger = mk(); set(stranger, 'social', { relationship: 'stranger', trust: 0.5 }); stranger.air()
  const rC = pf(close).display.rules, rS = pf(stranger).display.rules
  ok('P14', rC === 0.7 && rS === 0.2 && pf(stranger).display.mask > pf(close).display.mask + 0.05,
    `表达规则 主人 ${rC} / 外人 ${rS}；抑制 ${f(pf(close).display.mask)} vs ${f(pf(stranger).display.mask)}`)
}

// P15 调节策略选择：高负荷 / 没带宽时退回压抑
{
  const loaded = mk()
  set(loaded, 'pfc', { bandwidth: 0.2 }); loaded.air(); loaded.say(INSULT)
  const calm = mk(); calm.air()
  ok('P15', pf(loaded).reappraisal.strategy === '压抑' && pf(calm).reappraisal.strategy === 'none',
    `高负荷策略=${pf(loaded).reappraisal.strategy}，安静时=${pf(calm).reappraisal.strategy}`)
}

// P16 认知负荷：连着抑制 3 天，带宽上限 -25%
{
  const base = mk(); base.air()
  const cap0 = pf(base).cap
  const x = mk()
  for (let i = 0; i < 72; i++) { x.go(HOUR); x.say(i % 2 ? INSULT : INSULT2) }
  const capEnd = pf(x).cap
  ok('P16', pf(x).fatigue > 0.7 && capEnd <= cap0 * 0.75,
    `3 天连轴：疲劳 ${f(pf(x).fatigue)}，带宽上限 ${f(cap0)} → ${f(capEnd)}（-${f((1 - capEnd / cap0) * 100, 1)}%）`)
}

// P17 后悔：反复想另一种可能，然后淡下去
{
  const x = mk(); x.air()
  const r0 = pf(x).regret
  x.say('要是刚才我没说那句话就好了')
  const r1 = pf(x).regret
  x.min(90)
  const r2 = pf(x).regret
  ok('P17', r1 > 0.1 && r1 > r0 + 0.1 && r2 < r1 * 0.6,
    `regret ${f(r0)} →（反事实）${f(r1)} →（90 分钟）${f(r2)}`)
}

// P18 自上而下注意：能把注意从"那句话"上拉回来
{
  const build = (bw) => {
    const x = mk(); x.say(INSULT); x.min(2)
    set(x, 'pfc', { bandwidth: bw }); x.air()
    const peak = att(x).sticky
    x.say('我们做正事吧，帮我看下这张表')
    x.min(10)
    return { peak, after: att(x).sticky }
  }
  const hi = build(0.8)
  const lo = build(0.1)
  ok('P18', hi.after < hi.peak * 0.5 && hi.after < lo.after * 0.85,
    `拉回注意：黏着 ${f(hi.peak)} → ${f(hi.after)}（带宽低时 ${f(lo.after)}）`)
}

// P19 语言命名：把感觉叫出名字，强度降 ≥10%
{
  const mkPair = () => {
    const x = mk(); x.say(INSULT); x.min(1); x.say(INSULT2)
    return x
  }
  const a = mkPair(); const b = mkPair()
  const iA0 = fused(a).emotions?.[0]?.intensity ?? 0
  const iB0 = fused(b).emotions?.[0]?.intensity ?? 0
  a.say('我现在有点难过')
  b.say('我现在有点想睡')
  const iA = fused(a).emotions?.[0]?.intensity ?? 0
  const iB = fused(b).emotions?.[0]?.intensity ?? 0
  ok('P19', pf(a).labeling > 0.5 && pf(b).labeling < 0.1
    && iA0 > 0.1 && Math.abs(iB0 - iA0) < 0.15 && iA < iA0 * 0.9,
    `命名后 labeling=${f(pf(a).labeling)}，情绪强度 ${f(iA0)} → ${f(iA)}（对照 ${f(iB)}）`)
}

// P20 自我参照：跟自己相关的事权重更高
{
  const own = mk(); own.say('我今天真的撑不住了')
  const other = mk(); other.say('他今天真的撑不住了')
  const sOwn = pf(own).selfRef, sOther = pf(other).selfRef
  ok('P20', sOwn > sOther + 0.15, `selfRef 说"他" ${f(sOther)} → 说"我" ${f(sOwn)}`)
}

// P21 反事实思维：结果差 / 说重了 → 生成"要是"
{
  const x = mk(); x.say('你又搞砸了')
  x.ast('你行不行啊，这都做不好')
  const r = pf(x).regret
  ok('P21', r > 0.1, `说重话之后 regret=${f(r)}（开始倒带"要是刚才没说"）`)
}

// P22 事后找补：说重了会想补一句
{
  const hot = mk(); hot.say(INSULT); hot.min(1); hot.say(INSULT2); hot.min(1); hot.min(2)
  const calm = mk(); calm.say(NEUTRAL); calm.min(1); calm.say(NEUTRAL); calm.min(2)
  const rH = pf(hot).repair, rC = pf(calm).repair
  ok('P22', rH > 0.1 && rH > rC + 0.1, `repair 平静 ${f(rC)} → 说重了 ${f(rH)}`)
}

// P23 时间压力：赶时间时把情绪压住（话更短）
{
  const hurry = mk(); hurry.go(5 * MIN)
  hurry.say('你怎么又这样，说了几遍还是不改，快点，我赶时间')
  const complain = mk(); complain.go(5 * MIN)
  complain.say('你怎么又这样，说了几遍还是不改')
  const tpH = pf(hurry).timePressure, tpC = pf(complain).timePressure
  const bH = fused(hurry).io?.brevity ?? 0
  const bC = fused(complain).io?.brevity ?? 0
  ok('P23', tpH > 0.5 && tpC < 0.5 && bH > bC + 0.03,
    `timePressure 抱怨 ${f(tpC)} → 赶时间 ${f(tpH)}；brevity ${f(bC)} → ${f(bH)}`)
}

// ══════════════════════ 表 7 · 注意 ══════════════════════

// N01 感觉门控：高唤醒时把无关信息滤掉
{
  const hot = mk(); hot.say(INSULT); hot.min(2); hot.say(INSULT2); hot.min(2)
  const calm = mk(); calm.say(NEUTRAL); calm.min(2); calm.say(NEUTRAL); calm.min(2)
  const gH = att(hot).gate, gC = att(calm).gate
  ok('N01', gH < gC - 0.05, `gate 平静 ${f(gC)} → 高唤醒 ${f(gH)}（门关小了）`)
}

// N02 定向：新异抢注意
{
  const x = mk(); x.min(3)
  const focusIdle = att(x).focus
  x.go(3 * MIN)
  x.say('今天地铁上有人在拉手风琴，还带着一只特别大的橘猫，全车厢都在看')
  const focusNew = att(x).focus
  ok('N02', focusNew > focusIdle + 0.03 && att(x).target === '新出现的动静',
    `focus ${f(focusIdle)} → ${f(focusNew)}，定向=${att(x).target}`)
}

// N03 凸显网络：高显著事件打断手头的事
{
  const x = mk(); x.act('洗碗'); x.min(1)
  x.say(INSULT); x.min(1); x.say(INSULT2); x.min(1)
  const s = att(x).salienceNet
  ok('N03', s > 0.35 && att(x).target === '他那句话',
    `salienceNet=${f(s)}，注意转向 ${att(x).target}（手头的事被打断）`)
}

// N04 注意窄化：情绪高时只看得见坏的那面
{
  const x = mk()
  x.say(INSULT); x.min(1); x.say(INSULT2); x.min(1)
  const nar = att(x).narrowing
  const kinds = (fused(x).emotions ?? []).map(e => e.kind)
  ok('N04', nar > 0.55 && kinds.every(k => NEG_KINDS.has(k)),
    `narrowing=${f(nar)}，这一刻的情绪只剩 [${kinds.join('、') || '空'}]`)
}

// N05 脱离困难：越想越气（黏着累积）
{
  const x = mk()
  x.min(2); x.say(INSULT)
  const s1 = att(x).sticky
  x.min(2); x.say(INSULT2)
  x.min(2); x.say(INSULT)
  const s3 = att(x).sticky
  ok('N05', s3 > s1 + 0.05 && s3 > 0.15, `sticky ${f(s1)} → ${f(s3)}（三句之后越来越黏）`)
}

// N06 注意恢复：转移之后 10 分钟回落
{
  const x = mk(); x.say(INSULT); x.min(2)
  const peak = att(x).sticky
  x.say('我先去把碗洗了'); x.act('洗碗')
  x.min(10)
  const after = att(x).sticky
  ok('N06', after < peak * 0.5, `sticky 峰值 ${f(peak)} → 10 分钟后 ${f(after)}（回落）`)
}

// ══════════════════════ 表 8 · 社会 ══════════════════════

// S01 自我/他人区分：分清是谁在难受
{
  const other = mk(); other.say(HURT_OTHER); other.min(1)
  const own = mk(); own.say(HURT_SELF); own.min(1)
  const o = soc(other).otherFelt, s = soc(own).otherFelt
  ok('S01', o > 0.4 && s < 0.2, `"他难受" otherFelt=${f(o)}；"我难受"=${f(s)}（没混成一个人）`)
}

// S02 心智化：对方敷衍，读得出来
{
  const perf = mk(); perf.min(1); perf.say('随便吧，你定')
  const sincere = mk(); sincere.min(1); sincere.say('我想了想，这样做比较好')
  const mP = soc(perf).mindRead, mS = soc(sincere).mindRead
  ok('S02', mP > 0.7 && mP > mS + 0.15 && soc(perf).trust < soc(sincere).trust,
    `mindRead 认真 ${f(mS)} → 敷衍 ${f(mP)}；信任 ${f(soc(sincere).trust)} → ${f(soc(perf).trust)}`)
}

// S03 情感共情：对方哭，自己强度也上来
{
  const base = mk(); base.say(NEUTRAL)
  const a0 = soc(base).affectiveEmpathy
  const x = mk(); x.say('他撑不住了，一直在哭'); x.min(2)
  const a1 = soc(x).affectiveEmpathy
  ok('S03', a1 > 0.45 && a1 > a0 + 0.1, `affectiveEmpathy ${f(a0)} → ${f(a1)}`)
}

// S04 认知共情：能理解，不必感同身受
{
  const x = mk(); x.say(NEUTRAL)
  const cog = soc(x).cognitiveEmpathy
  const aff = soc(x).affectiveEmpathy
  ok('S04', cog > 0.45 && cog > aff + 0.1, `认知 ${f(cog)} vs 情感 ${f(aff)}（理解 ≠ 被带着走）`)
}

// S05 社会排斥痛：被冷落真的疼
{
  const x = mk(); x.say('哦')
  const p = soc(x).socialPain
  ok('S05', p > 0.15, `被晾一句之后 socialPain=${f(p)}`)
}

// S06 依恋模型：连着被晾 → 焦虑型，回复变慢
{
  const x = mk()
  const d0 = Number(x.e.organs.io.read()?.replyDelayMs ?? 0)
  for (let i = 0; i < 3; i++) { x.min(1); x.say(COLD) }
  const d1 = Number(fused(x).io?.replyDelayMs ?? 0)
  ok('S06', soc(x).attachment === 'anxious' && d1 > d0 + 60_000,
    `依恋=${soc(x).attachment}，回复延迟 ${f(d0)}ms → ${f(d1)}ms`)
}

// S07 关系账本：没清账，防备放不下来；道歉才清
{
  const x = mk(); x.say('哦'); x.min(1)
  const n1 = soc(x).ledgerOpen
  const reason = soc(x).ledger?.[0]?.reason || '-'
  x.min(1); x.say(PREP)
  const n2 = soc(x).ledgerOpen
  ok('S07', n1 >= 1 && n2 === 0 && /晾/.test(reason), `账本 ${n1} 笔（${reason}）→ 道歉后 ${n2} 笔`)
}

// S08 权力/地位：被谢被夸抬一点，被骂掉一点
{
  const up = mk()
  up.say(WARM); up.min(1); up.say('你真好，谢谢你')
  const down = mk()
  down.say(INSULT); down.min(1); down.say(INSULT2)
  const sUp = soc(up).status, sDown = soc(down).status
  ok('S08', sUp > sDown + 0.04, `status 被骂 ${f(sDown)} → 被谢 ${f(sUp)}`)
}

// S09 情绪传染：她低落，语气也跟着沉下去
{
  const x = mk()
  for (let i = 0; i < 3; i++) { x.min(1); x.say(i % 2 ? '我难受得要命，喘不上气' : '我真的撑不住了，眼泪止不住') }
  const c = soc(x).contagionOut
  ok('S09', c > 0.15, `contagionOut=${f(c)}（情绪外溢到语气上）`)
}

// S10 共情疲劳：连着安慰会累
{
  const x = mk()
  for (let i = 0; i < 4; i++) { x.min(1); x.say(i % 2 ? HURT_OTHER : '他今天又崩溃了') }
  const fat = soc(x).empathyFatigue
  ok('S10', fat > 0.1, `连续安慰之后 empathyFatigue=${f(fat)}`)
}

// S11 对人的长期态度：多次事件后漂移
{
  const good = mk()
  for (let i = 0; i < 5; i++) { good.min(1); good.say(i % 2 ? WARM : '谢谢你啊') }
  const bad = mk()
  for (let i = 0; i < 5; i++) { bad.min(1); bad.say(i % 2 ? INSULT : INSULT2) }
  const aG = Number(soc(good).attitude['他'] ?? 0)
  const aB = Number(soc(bad).attitude['他'] ?? 0)
  ok('S11', aG > 0.05 && aB < -0.1, `态度 坏 ${f(aB)} vs 好 ${f(aG)}（攒出来的）`)
}

// S12 信任：兑现 +、失信 -
{
  const good = mk()
  for (let i = 0; i < 3; i++) { good.min(1); good.say(i % 2 ? WARM : '谢谢你') }
  const bad = mk()
  for (let i = 0; i < 3; i++) { bad.min(1); bad.say(i % 2 ? INSULT : INSULT2) }
  const tG = soc(good).trust, tB = soc(bad).trust
  ok('S12', tG > 0.6 + 0.05 && tB < 0.6 - 0.08, `trust 基线 0.6 → 兑现 ${f(tG)} / 失信 ${f(tB)}`)
}

// ══════════════════════ 表 10 · 默认模式 ══════════════════════

// D01 走神：没人说话 10 分钟触发
{
  const x = mk(); x.min(10)
  const w = dmn(x).mindWander
  ok('D01', w > 0.15, `10 分钟没人说话 mindWander=${f(w)}`)
}

// D02 自我参照思维：独处时想自己的事
{
  const alone = mk(); alone.min(10); alone.min(10)
  const withHim = mk()
  for (let i = 0; i < 4; i++) { withHim.min(1); withHim.say(i % 2 ? NEUTRAL : '在的') }
  const sA = dmn(alone).selfThought, sW = dmn(withHim).selfThought
  ok('D02', sA > sW + 0.05, `selfThought 有人说话 ${f(sW)} → 独处 ${f(sA)}`)
}

// D03 反刍：负性事件之后反复出现
{
  const neg = mk(); neg.say(INSULT); neg.min(5)
  const calm = mk(); calm.say(NEUTRAL); calm.min(5)
  const rN = dmn(neg).rumination, rC = dmn(calm).rumination
  ok('D03', rN > 0.1 && rN > rC + 0.08, `rumination 平静 ${f(rC)} → 被怼 ${f(rN)}`)
}

// D04 心理时间：会想"以后/上次"
{
  const neg = mk(); neg.say(INSULT); neg.min(5)
  const calm = mk(); calm.say(NEUTRAL); calm.min(5)
  const mN = dmn(neg).mentalTime, mC = dmn(calm).mentalTime
  ok('D04', mN > 0.4 && mN > mC + 0.05, `mentalTime 平静 ${f(mC)} → 负性 ${f(mN)}`)
}

// D05 社交想象：一个人待久了会想"他在干嘛"
{
  const x = mk(); x.air()
  const s0 = dmn(x).socialImagining
  x.min(10); x.min(10); x.min(10)
  const s1 = dmn(x).socialImagining
  ok('D05', s1 > 0.3 && s1 > s0 + 0.08, `socialImagining ${f(s0)} →（独处 30 分钟）${f(s1)}`)
}

// ══════════════════════ 表 12 · 病感 ══════════════════════

// F01 炎症→低落：生病 mood -0.15
{
  const ill = mk(); ill.say('我发烧了，还一直咳嗽'); ill.min(3)
  const well = mk(); well.say(NEUTRAL); well.min(3)
  const vIll = Number(fused(ill).valence ?? 0)
  const vWell = Number(fused(well).valence ?? 0)
  ok('F01', vIll < vWell - 0.15, `valence 健康 ${f(vWell)} → 生病 ${f(vIll)}（当场就往下走）`)
}

// F02 疲劳：乏力慢慢上、慢慢退（比炎症拖得久）
{
  const x = mk(); x.say('我发烧了，嗓子疼，浑身没劲')
  x.min(5)
  const fat = sick(x).fatigue
  const infl0 = sick(x).inflammation
  x.min(60)
  const fat2 = sick(x).fatigue
  const infl2 = sick(x).inflammation
  ok('F02', fat > 0.2 && fat2 > infl2 && fat2 > 0.15,
    `fatigue ${f(fat)}→${f(fat2)}；炎症 ${f(infl0)}→${f(infl2)}（疲劳更拖）`)
}

// F03 社交退缩：生病不想聊（话更短）
{
  const ill = mk(); ill.say('我发烧了，嗓子疼'); ill.min(5)
  const well = mk(); well.say(NEUTRAL); well.min(5)
  const wd = sick(ill).withdraw
  const bIll = Number(fused(ill).io?.brevity ?? 0)
  const bWell = Number(fused(well).io?.brevity ?? 0)
  ok('F03', wd > 0.1 && bIll > bWell + 0.02, `withdraw=${f(wd)}，brevity ${f(bWell)} → ${f(bIll)}`)
}

// F04 痛觉敏化：同样的痛，病中更疼
{
  const ill = mk(); ill.say('我发烧了，浑身疼'); ill.min(10)
  const well = mk(); well.say(NEUTRAL); well.min(10)
  const pI = Number(fused(ill).body?.pain ?? 0)
  const pW = Number(fused(well).body?.pain ?? 0)
  ok('F04', sick(ill).hyperalgesia > 0.3 && pI > pW * 1.12,
    `同强度痛感 健康 ${f(pW)} → 病中 ${f(pI)}（×${f(pI / Math.max(1e-6, pW), 2)}）`)
}

// ── 汇总 ─────────────────────────────────────────────
const failed = results.filter(r => !r.pass)
console.log('')
console.log(`断言 ${results.length} 条，失败 ${failed.length} 条`)
console.log(failed.length ? `FAIL：${failed.map(r => r.id).join(' ')}` : 'PASS 六张表的行为断言全绿')
process.exit(failed.length ? 1 : 0)
