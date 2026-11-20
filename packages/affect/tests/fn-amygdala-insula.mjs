// 功能断言：表 1「杏仁核」A01–A21、表 3「岛叶」I01–I17。
//   node tests/fn-amygdala-insula.mjs
//
// 每条都是"给一个刺激 → 某个字段/输出跟着变"，用 createEngine({ now }) 走真实心跳。
// 只在两处碰器官内部：snapshot/restore 摆一个"睡够了 / 刚醒但皮质醇还高"的处境，
// 以及读 params.tauThreat 把 threat 的变化换算成"注入量"（不然单帧熔断会把增量吃掉）。
// 免做：I06 痒、I07 味觉、I17 敬畏（消融过，见功能总表），这里写成豁免注释，不计失败。

import { createEngine } from '../core/engine.js'

const MIN = 60_000
const DAY = 86_400_000
const T_DAY = new Date('2026-11-12T09:00:00+08:00').getTime()
const T_NIGHT = new Date('2026-11-12T23:00:00+08:00').getTime()

const results = []
const ok = (id, cond, msg) => {
  results.push({ id, pass: !!cond, msg })
  console.log(`${cond ? 'ok' : 'FAIL'}: ${id} ${msg}`)
}
const f = (n, d = 3) => (Number.isFinite(Number(n)) ? Number(n).toFixed(d) : String(n))

// ── 引擎夹具：时钟自己推，台词自己发 ─────────────────────
function mk(t0 = T_DAY) {
  let t = t0
  const e = createEngine({ now: () => t })
  const api = {
    e,
    at: () => t,
    go(ms) { t += ms; return api },
    min(m) { t += m * MIN; return api },
    // K07 幂等：同一句话 30 秒内会被丢掉，所以调用方要把间隔拉开
    say(text) { e.tick([{ type: 'user', text, at: t }]); return api },
    ast(text) { e.tick([{ type: 'assistant', text, at: t }]); return api },
    air() { e.tick([]); return api },
  }
  return api
}
const a = (x) => x.e.organs.amygdala.read()
const ins = (x) => x.e.organs.insula.read()
const hyp = (x) => x.e.organs.hypothalamus.read()
const pfc = (x) => x.e.organs.pfc.read()
const tauThreat = (x) => Number(x.e.organs.amygdala.params.tauThreat) || 8
// 这一拍的"注入量"：把自然衰减扣掉，剩下的才是这次刺激真正加进去的威胁
const drive = (x, before, after, dtMs = MIN) => after - before * Math.exp(-(dtMs / MIN) / tauThreat(x))
const setHyp = (x, patch) => {
  const s = x.e.organs.hypothalamus.snapshot()
  Object.assign(s, patch)
  x.e.organs.hypothalamus.restore(s)
}

// 刺激
const STING = '你行不行啊，这都做不好，又崩了'   // 冷 + 你×2 → cue 冷
const CUE = '你就别管我了，你忙你的'             // 否定×1 + 你×2 → cue 否定，输入中等（不过熔断）
const MILD = '随便你'                            // 冷，但短
const PRAISE = '做得好，这次很稳，谢谢你'
const NEUTRAL = '今天周三'
const APOLOGY = '对不起，是我说重了'
const HURT = '我今天好难受，撑不住了'
const AMBIG = '也许吧，看情况'
const SURE = '就这个，确定了'
const WEAK = '你也太狠了吧'
const DISGUST = '有点恶心，想吐'
const COLD = '外面好冷，冻得手都僵了'
const ACHE = '腰疼得厉害'
const CONTEMPT = '呵呵'

// ── A01 快速威胁检测：1 拍内 threat 上升 ─────────────────
{
  const x = mk()
  const before = a(x).threat
  x.say(STING)
  const after = a(x).threat
  ok('A01', after > before * 3 && after > 0.2 && a(x).fastThreat >= after,
    `同一拍里 threat ${f(before)} → ${f(after)}（快评 fastThreat=${f(a(x).fastThreat)}）`)
}

// ── A02 精细评价：慢评（PFC 归因）把威胁往下修 ≥15% ───────
{
  // 轻度：一句话顶一下（threat < 0.6）→ 归因落在"环境"（circumstance），慢评每拍 ×0.92；
  // 重度：三句顶到 0.6 以上 → 归因转向"他"（other），慢评不再修正。
  // 两条轨迹各按自己的起点归一，再比残余比——这样比的是"慢评修了多少"，不是"谁起点高"。
  const mild = mk(); mild.say(MILD)
  const mild0 = a(mild).threat
  for (let i = 0; i < 3; i++) { mild.min(1); mild.air() }
  const mild1 = a(mild).threat
  const strong = mk()
  for (let i = 0; i < 3; i++) { strong.min(1); strong.say(STING) }
  const strong0 = a(strong).threat
  for (let i = 0; i < 3; i++) { strong.min(1); strong.air() }
  const strong1 = a(strong).threat
  const ratioMild = mild1 / mild0
  const ratioStrong = strong1 / strong0
  const locusMild = pfc(mild).attribution.locus
  const locusStrong = pfc(strong).attribution.locus
  ok('A02', locusMild === 'circumstance' && locusStrong === 'other' && ratioMild <= ratioStrong * 0.85,
    `归因 ${locusMild}/${locusStrong}；三拍后残余比 ${f(ratioMild)} vs ${f(ratioStrong)}（慢评多修了 ${f((1 - ratioMild / ratioStrong) * 100, 1)}%）`)
}

// ── A03 显著性打分：与威胁、奖赏都单调 ──────────────────
{
  const sting = mk(); sting.say(STING)
  const praise = mk(); praise.say(PRAISE)
  const plain = mk(); plain.air()
  const sSting = a(sting).salience
  const sPraise = a(praise).salience
  const sPlain = a(plain).salience
  ok('A03', sSting > sPlain + 0.15 && sPraise > sPlain + 0.10,
    `salience 平静 ${f(sPlain)} → 被骂 ${f(sSting)} / 被夸 ${f(sPraise)}`)
}

// ── A04 奖赏预测误差：PE = 实际 − 预期（预期 0.1）─────────
{
  const praise = mk(); praise.say(PRAISE)
  const plain = mk(); plain.say(NEUTRAL)
  const pePraise = a(praise).rewardPE
  const pePlain = a(plain).rewardPE
  ok('A04', pePraise > 0.3 && Math.abs(pePraise - 0.45) < 0.05 && Math.abs(pePlain) < 0.02,
    `被夸 rewardPE=${f(pePraise)}（预期 0.1 → 0.45），中性 rewardPE=${f(pePlain)}`)
}

// ── A05 恐惧学习·线索：同一条线索 3 次 → 增量 ≥1.3 倍 ─────
{
  const x = mk()
  const incs = []
  for (let i = 0; i < 3; i++) {
    if (i) x.min(1)
    const before = a(x).threat
    x.say(CUE)
    incs.push(drive(x, before, a(x).threat))
  }
  const gain = incs[2] / incs[0]
  ok('A05', gain >= 1.3 && a(x).sensMax >= 1.3,
    `同一线索 ${CUE} 三次：注入量 ${incs.map(v => f(v)).join(' → ')}（×${f(gain, 2)}），sens=${f(a(x).sensMax, 2)}`)
}

// ── A06 恐惧学习·情境：怕过的夜间场景基线 +0.2 ───────────
{
  const night = mk(T_NIGHT)
  for (let i = 0; i < 6; i++) { night.min(1); night.say(STING) }
  for (let i = 0; i < 6; i++) { night.min(10); night.air() }
  const nightThreat = a(night).threat
  const nightCtx = Number(a(night).context.night || 0)
  // 对照：白天被同样的内容扎过（怕的是 home），夜里那个场景没被条件化
  const day = mk(T_DAY)
  for (let i = 0; i < 6; i++) { day.min(1); day.say(STING) }
  for (let i = 0; i < 6; i++) { day.min(10); day.air() }
  day.go(new Date('2026-11-12T23:20:00+08:00').getTime() - day.at())
  day.air()
  const dayThreat = a(day).threat
  ok('A06', nightCtx > 0.6 && nightThreat >= 0.15 && nightThreat - dayThreat >= 0.12,
    `夜间情境恐惧 ${f(nightCtx, 2)} → 夜深了 threat 托在 ${f(nightThreat)}；没被条件化的夜里只有 ${f(dayThreat)}（差 ${f(nightThreat - dayThreat)}）`)
}

// ── A07 消退：pfcGain 高时道歉压 ≥50%，低时压不动 ────────
{
  // 睡饱（sleepDebt 0）→ pfcGain 高；缺觉 → pfcGain 低。两条都用"同一小时，道不道歉"做对照。
  const run = (sleepDebt) => {
    const withApology = mk()
    setHyp(withApology, { sleepDebt })
    withApology.say(STING)
    withApology.min(1); withApology.say(APOLOGY)
    const after = a(withApology).threat
    const gain = Number(pfc(withApology).pfcGain)
    const control = mk()
    setHyp(control, { sleepDebt })
    control.say(STING)
    control.min(1); control.air()
    const base = a(control).threat
    return { after, base, gain, drop: 1 - after / base }
  }
  const rested = run(0)
  const tired = run(0.9)
  ok('A07', rested.gain > 0.55 && rested.drop >= 0.5 && tired.drop < 0.2 && tired.drop < rested.drop - 0.25,
    `pfcGain ${f(rested.gain, 2)} 时道歉压掉 ${f(rested.drop * 100, 1)}%；缺觉 pfcGain 低，只压掉 ${f(tired.drop * 100, 1)}%`)
}

// ── A08 自发恢复：14 天无暴露 → safety <0.7 ──────────────
{
  const x = mk()
  x.say(STING)                       // 先建一条线索（cue 冷）
  for (let i = 0; i < 10; i++) { x.min(1); x.say(APOLOGY) }
  const s0 = Number(a(x).safety['冷'] || 0)
  // 引擎单拍最多补算 24 小时，所以十四天要一天一天走
  for (let i = 0; i < 14; i++) { x.go(DAY); x.air() }
  const s1 = Number(a(x).safety['冷'] || 0)
  ok('A08', s0 > 0.7 && s1 < 0.7 && s1 < s0,
    `安全记忆 ${f(s0, 2)} 攒住后，十四天没再提 → ${f(s1, 2)}（自发恢复的前置）`)
}

// ── A09 复燃：换回怕过的场景，旧恐惧回升 ─────────────────
{
  const x = mk(T_NIGHT)
  for (let i = 0; i < 6; i++) { x.min(1); x.say(STING) }
  // 第二天白天（场景回到 home，没被条件化过）→ 威胁退下去
  x.go(new Date('2026-11-13T10:00:00+08:00').getTime() - x.at())
  for (let i = 0; i < 3; i++) { x.min(10); x.air() }
  const beforeReturn = a(x).threat
  // 当晚又到夜里（night 场景）
  x.go(new Date('2026-11-13T23:20:00+08:00').getTime() - x.at())
  x.air()
  const afterReturn = a(x).threat
  const fresh = mk(T_NIGHT)
  fresh.air()
  ok('A09', beforeReturn < 0.08 && afterReturn - beforeReturn >= 0.1 && afterReturn > a(fresh).threat + 0.1,
    `白天 threat ${f(beforeReturn)} → 回到那个夜里 ${f(afterReturn)}（回升 ${f(afterReturn - beforeReturn)}）`)
}

// ── A10 应激复现：皮质醇顶起来，旧恐惧自己回来 ───────────
{
  // 先怕 → 再消退（道歉）→ 再摆一个"刚醒、皮质醇还高"的处境
  const build = (cort) => {
    const x = mk()
    x.say(STING)
    for (let i = 0; i < 10; i++) { x.min(1); x.say(APOLOGY) }
    const snap = x.e.snapshot()
    snap.organs.hypothalamus.cortisol = cort
    snap.organs.hypothalamus.stressLoad = cort
    snap.organs.amygdala.cort = cort
    x.e.restore(snap)
    x.min(1)
    x.air()
    return a(x).threat
  }
  const high = build(0.85)
  const low = build(0.15)
  ok('A10', high - low >= 0.1,
    `皮质醇 0.85 时旧恐惧回到 ${f(high)}；皮质醇 0.15 时只有 ${f(low)}（差 ${f(high - low)}）`)
}

// ── A11 泛化：怕过的线索，相似线索也会紧一下 ─────────────
{
  const similar = '你要不要试试别的办法'   // cue 否定，跟"冷"不是同一条
  const x = mk()
  for (let i = 0; i < 3; i++) { x.min(1); x.say(STING) }
  x.min(90); x.air()                       // 让 A12 那股劲回弹，只留线索级的敏化
  const beforeSimilar = a(x).threat
  x.min(1); x.say(similar)
  const gotSimilar = drive(x, beforeSimilar, a(x).threat)
  const beforePlain = a(x).threat
  x.min(1); x.say(NEUTRAL)
  const gotPlain = drive(x, beforePlain, a(x).threat)
  const fresh = mk()
  const bf = a(fresh).threat
  fresh.min(1); fresh.say(similar)
  const gotFresh = drive(fresh, bf, a(fresh).threat)
  ok('A11', gotSimilar > gotFresh * 1.15 && gotPlain < gotFresh * 0.5,
    `相似线索注入量 ${f(gotSimilar)}（新引擎 ${f(gotFresh)}，×${f(gotSimilar / gotFresh, 2)}）；中性话只有 ${f(gotPlain)}（不瞎泛化）`)
}

// ── A12 敏化：反复受挫，触发阈值下移 ─────────────────────
{
  const x = mk()
  const thr0 = a(x).threshold
  const b0 = a(x).threat
  x.say(WEAK)                              // 弱刺激：cue 为空，只走阈值
  const weak0 = drive(x, b0, a(x).threat)
  for (let i = 0; i < 4; i++) { x.min(1); x.say(STING) }
  x.min(10); x.air()                       // 威胁退下去，但"还没缓过来"那股劲还在（30 分钟量级）
  const thr1 = a(x).threshold
  const b1 = a(x).threat
  x.min(1); x.say(WEAK)
  const weak1 = drive(x, b1, a(x).threat)
  ok('A12', thr1 < thr0 - 0.1 && weak1 > weak0 * 1.3,
    `阈值 ${f(thr0, 2)} → ${f(thr1, 2)}；同一句弱刺激的注入量 ${f(weak0)} → ${f(weak1)}（×${f(weak1 / weak0, 2)}）`)
}

// ── A13 习惯化：同一线索 20 次后 sens <1.2 ───────────────
{
  const x = mk()
  for (let i = 0; i < 20; i++) { x.min(1); x.say(CUE) }
  const sens = a(x).sensMax
  ok('A13', sens < 1.2,
    `同一条线索连着 20 次、没有新威胁 → sens 从 1.45 钝化到 ${f(sens, 2)}`)
}

// ── A14 社会性线索：轻蔑语气 threat 更高 ─────────────────
{
  const contempt = mk(); contempt.say(CONTEMPT)
  const plain = mk(); plain.say(NEUTRAL)
  ok('A14', a(contempt).threat > a(plain).threat + 0.1,
    `一句"${CONTEMPT}" threat=${f(a(contempt).threat)}；中性话 ${f(a(plain).threat)}`)
}

// ── A15 替代学习：对方难受 → 自身 threat↑ ────────────────
{
  const hurt = mk(); hurt.say(HURT)
  const plain = mk(); plain.say(NEUTRAL)
  ok('A15', a(hurt).threat - a(plain).threat >= 0.08,
    `他说"难受"时 threat=${f(a(hurt).threat)}；中性话 ${f(a(plain).threat)}（替代学习那一笔）`)
}

// ── A16 不确定性：模糊比确定更吓人 ──────────────────────
{
  const vague = mk(); vague.say(AMBIG)
  const sure = mk(); sure.say(SURE)
  ok('A16', a(vague).threat > a(sure).threat + 0.03,
    `"${AMBIG}" threat=${f(a(vague).threat)}；"${SURE}" threat=${f(a(sure).threat)}`)
}

// ── A17 注意捕获：高唤醒开 5 秒窗口 ─────────────────────
{
  const hot = mk()
  hot.min(1); hot.say(STING)
  hot.min(1); hot.say(STING)          // 第二句把威胁顶过 0.6：这一瞬开窗
  const captureNow = a(hot).capture
  hot.go(10_000); hot.air()           // 5 秒窗口过了
  const captureLater = a(hot).capture
  const mild = mk(); mild.say(NEUTRAL)
  ok('A17', captureNow > 0.3 && captureLater === 0 && a(mild).capture === 0,
    `高唤醒那一瞬 capture=${f(captureNow, 2)}，10 秒后 ${f(captureLater, 2)}；不吓人的话 ${f(a(mild).capture, 2)}`)
}

// ── A18 情绪增强记忆：高 salience 保留 ≥200 天 ───────────
{
  const x = mk()
  for (let i = 0; i < 3; i++) { x.min(1); x.say(STING) }
  const tags = a(x).deepTags
  const tag = tags[tags.length - 1]
  const keepDays = tag ? Number(tag.keepDays) : 0
  // 199 天后还在，201 天后淡掉
  const y = mk()
  for (let i = 0; i < 3; i++) { y.min(1); y.say(STING) }
  y.go(199 * DAY); y.air()
  const stillThere = a(y).deepTags.length
  y.go(2 * DAY); y.air()
  const gone = a(y).deepTags.length
  const bland = mk(); bland.say(NEUTRAL)
  ok('A18', a(x).salience >= 0.6 && keepDays >= 200 && stillThere >= 1 && gone === 0 && a(bland).deepTags.length === 0,
    `salience ${f(a(x).salience, 2)} → 打上 ${keepDays} 天保留标；199 天还剩 ${stillThere} 条，201 天后 ${gone} 条；平淡一句不给标`)
}

// ── A19 应激激素调控：threat 高 → 皮质醇到 0.6 量级 ─────
{
  const x = mk()
  for (let i = 0; i < 30; i++) { x.min(1); x.say(STING) }
  const calm = mk()
  for (let i = 0; i < 30; i++) { calm.min(1); calm.air() }
  const cort = Number(hyp(x).hpa.cortisol)
  const cortCalm = Number(hyp(calm).hpa.cortisol)
  ok('A19', a(x).threat > 0.8 && cort >= 0.5 && cort <= 0.8 && cort > cortCalm + 0.3,
    `threat ${f(a(x).threat, 2)} 持续顶着 → 下丘脑皮质醇 ${f(cort)}（平静 ${f(cortCalm)}）`)
}

// ── A20 僵住/惊跳：极端 threat 时话变短 ─────────────────
{
  const x = mk()
  for (let i = 0; i < 6; i++) { x.min(1); x.say(STING) }
  const frozen = a(x).freeze
  const brev = Number(x.e.read().io?.brevity ?? 0)
  const calm = mk()
  calm.say(NEUTRAL)
  const brevCalm = Number(calm.e.read().io?.brevity ?? 0)
  ok('A20', frozen > 0.4 && brev > brevCalm + 0.05,
    `极端 threat（${f(a(x).threat, 2)}）freeze=${f(frozen, 2)}，输出句长 ${f(brevCalm, 2)} → ${f(brev)}（话变短）`)
}

// ── A21 自我评价通路：她说了重话，自己也会被点着 ──────────
{
  const harsh = mk()
  const b = a(harsh).threat
  harsh.ast('你行不行，做不好就闭嘴')
  const harshThreat = a(harsh).threat
  const polite = mk()
  polite.ast('我把参数调好了，你看看')
  const politeThreat = a(polite).threat
  ok('A21', harshThreat - b >= 0.06 && harshThreat > politeThreat + 0.06,
    `她自己说重话 threat ${f(b)} → ${f(harshThreat)}；同样一拍里说句平话只有 ${f(politeThreat)}`)
}

// ── I01 心跳内感受：焦虑时 hr↑（岛叶读得到）─────────────
{
  const calm = mk(); calm.min(1); calm.air()
  const anxious = mk()
  for (let i = 0; i < 8; i++) { anxious.min(1); anxious.say(STING) }
  const hrCalm = Number(ins(calm).intero.hr)
  const hrUp = Number(ins(anxious).intero.hr)
  ok('I01', hrUp > hrCalm + 5 && hrUp === Number(hyp(anxious).body.hr),
    `心慌时心率 ${f(hrCalm, 1)} → ${f(hrUp, 1)}，岛叶读到的是同一个数`)
}

// ── I02 呼吸内感受：紧张时呼吸变快 ──────────────────────
{
  const calm = mk(); calm.min(1); calm.air()
  const tense = mk()
  for (let i = 0; i < 8; i++) { tense.min(1); tense.say(STING) }
  ok('I02', Number(ins(tense).intero.breath) > Number(ins(calm).intero.breath) + 1,
    `紧张时呼吸 ${f(ins(calm).intero.breath, 1)} → ${f(ins(tense).intero.breath, 1)} 次/分`)
}

// ── I03 胃肠内感受：厌恶时 gut<0（而且更靠下）───────────
{
  const calm = mk(); calm.min(1); calm.air()
  const yuck = mk(); yuck.say(DISGUST)
  const gutCalm = Number(ins(calm).intero.gut)
  const gut = Number(ins(yuck).intero.gut)
  ok('I03', gut < 0 && gut < gutCalm - 0.2 && ins(yuck).disgust > 0.3,
    `厌恶时胃里 ${f(gutCalm, 2)} → ${f(gut, 2)}，disgust=${f(ins(yuck).disgust, 2)}`)
}

// ── I04 温度内感受：冷 → 收紧感 ────────────────────────
{
  const calm = mk(); calm.min(1); calm.air()
  const cold = mk(); cold.say(COLD)
  const q = ins(cold).felt.qualities
  ok('I04', Number(ins(cold).intero.temp) < Number(ins(calm).intero.temp) - 0.2
    && q.some(x => x === '缩' || x === '紧'),
    `说冷之后体温读数 ${f(ins(calm).intero.temp, 2)} → ${f(ins(cold).intero.temp, 2)}，质地 [${q.join('、')}]（收紧）`)
}

// ── I05 痛的感觉成分：腰疼时含"酸/沉" ──────────────────
{
  const ache = mk(); ache.say(ACHE)
  const q = ins(ache).felt.qualities
  ok('I05', (q.includes('酸') || q.includes('沉')) && Number(ins(ache).intero.pain) > Number(ins(mk()).intero.pain),
    `"${ACHE}"的质地 [${q.join('、')}]，pain=${f(ins(ache).intero.pain, 2)}`)
}

// ── I06 痒：豁免（功能总表：消融过，跟情绪没有稳定关联）
// 免做项，不做断言。

// ── I07 味觉：豁免（只留"难吃 → 厌恶"那条通道，已被 I08 覆盖）
// 免做项，不做断言。

// ── I08 厌恶：有真线索才触发 ──────────────────────────
{
  const yuck = mk(); yuck.say(DISGUST)
  const rough = mk(); rough.say(STING)   // 被骂，但不是"恶心"
  ok('I08', ins(yuck).disgust > 0.3 && ins(rough).disgust < 0.15,
    `"${DISGUST}" disgust=${f(ins(yuck).disgust, 2)}；被骂但没说恶心 ${f(ins(rough).disgust, 2)}`)
}

// ── I09 情绪意识：强度高时误标下降 ─────────────────────
{
  const vague = mk(); vague.min(1); vague.air()
  const strong = mk()
  for (let i = 0; i < 6; i++) { strong.min(1); strong.say(STING) }
  const misVague = Number(ins(vague).mislabel)
  const misStrong = Number(ins(strong).mislabel)
  ok('I09', Number(ins(strong).felt.intensity) > Number(ins(vague).felt.intensity) + 0.3 && misStrong < misVague - 0.1,
    `体感 ${f(ins(vague).felt.intensity, 2)} → ${f(ins(strong).felt.intensity, 2)}，误标 ${f(misVague, 2)} → ${f(misStrong, 2)}（越响越说得清）`)
}

// ── I10 身体自我感：高唤醒时增强 ──────────────────────
{
  const calm = mk(); calm.min(1); calm.air()
  const hot = mk()
  for (let i = 0; i < 6; i++) { hot.min(1); hot.say(STING) }
  ok('I10', Number(ins(hot).bodySelf) > Number(ins(calm).bodySelf) + 0.05,
    `身体自我感 ${f(ins(calm).bodySelf, 2)} → ${f(ins(hot).bodySelf, 2)}`)
}

// ── I11 时间感（等待）：等 5 分钟烦躁 +0.1 ─────────────
{
  const x = mk()
  x.say('在先')                             // 有过话，才开始"等"
  for (let i = 0; i < 5; i++) { x.min(1); x.air() }
  const waited = Number(ins(x).wait)
  x.say('我回来了')
  const afterReply = Number(ins(x).wait)
  const idle = mk()                          // 一直没人说话：不是在等人，wait 不该自己涨
  for (let i = 0; i < 10; i++) { idle.min(1); idle.air() }
  ok('I11', waited >= 0.09 && waited <= 0.2 && afterReply <= 0.03 && Number(ins(idle).wait) < 0.02,
    `五分钟没人回：wait=${f(waited, 2)}；一回话就掉到 ${f(afterReply, 2)}；一直无人的独处 ${f(ins(idle).wait, 2)}（不算等）`)
}

// ── I12 不确定性/风险：不确定时强度更高 ────────────────
{
  const vague = mk(); vague.say(AMBIG)
  const sure = mk(); sure.say(SURE)
  ok('I12', Number(ins(vague).risk) > Number(ins(sure).risk) + 0.15,
    `"${AMBIG}" risk=${f(ins(vague).risk, 2)}；"${SURE}" risk=${f(ins(sure).risk, 2)}`)
}

// ── I13 共情共振：对方难受，自身同一拍里就同向 ───────────
{
  const hurt = mk(); hurt.say(HURT)
  const plain = mk(); plain.say(NEUTRAL)
  const res = Number(ins(hurt).resonance)
  ok('I13', res >= 0.2 && Number(ins(hurt).felt.intensity) > Number(ins(plain).felt.intensity) + 0.1,
    `他说难受的那一拍：共振 ${f(res, 2)}（不滞后），体感 ${f(ins(plain).felt.intensity, 2)} → ${f(ins(hurt).felt.intensity, 2)}`)
}

// ── I14 渴求：想要不得 → 烦躁 ─────────────────────────
{
  const lonely = mk(T_NIGHT)
  lonely.say('在吗')                                          // 她开口了，没人接
  for (let i = 0; i < 10; i++) { lonely.min(15); lonely.air() }   // 两个半小时干等
  const craving = Number(ins(lonely).craving)
  const irritation = Number(ins(lonely).irritation)
  const together = mk(T_NIGHT)
  for (let i = 0; i < 10; i++) { together.min(15); together.say('在呢') }
  ok('I14', craving >= 0.25 && irritation >= 0.15 && craving > Number(ins(together).craving),
    `开口没人应、干等两个半小时：渴求 ${f(craving, 2)}、烦躁 ${f(irritation, 2)}；一直有人应着时渴求 ${f(ins(together).craving, 2)}`)
}

// ── I15 内感受精度：注意时 0.3 → 0.9 ──────────────────
{
  const idle = mk()
  idle.min(1); idle.air(); idle.min(1); idle.air()   // 注意力还没落到身体上
  const low = Number(ins(idle).felt.precision)
  const focused = mk()
  for (let i = 0; i < 25; i++) { focused.min(1); focused.say(STING) }   // 盯住自己
  const high = Number(ins(focused).felt.precision)
  ok('I15', Math.abs(low - 0.3) <= 0.06 && high >= 0.85,
    `没在注意身体 ${f(low, 2)}；盯住自己 ${f(high, 2)}（注意力 onBody 的自然区间映射到 0.3~0.9）`)
}

// ── I16 误标：原因不明时 ≥0.5 ─────────────────────────
{
  const vague = mk()
  vague.min(1); vague.air()
  const mis = Number(ins(vague).mislabel)
  const conf = Number(pfc(vague).attribution.confidence)
  ok('I16', conf < 0.6 && mis >= 0.5,
    `说不清是谁的原因（归因置信 ${f(conf, 2)}）时误标 ${f(mis, 2)}`)
}

// ── I17 敬畏：豁免（功能总表：日常出现率 <1%）
// 免做项，不做断言。

// ── 汇总 ───────────────────────────────────────────────
const total = results.length
const failed = results.filter(r => !r.pass)
console.log('')
console.log(`断言 ${total} 条，失败 ${failed.length} 条（另有 3 条免做：I06 痒 / I07 味觉 / I17 敬畏）`)
if (failed.length) {
  console.log(`失败项：${failed.map(r => r.id).join(', ')}`)
  console.log('FAIL')
} else {
  console.log('PASS')
}
process.exit(failed.length ? 1 : 0)
