// B01–B05（脑干）、E01–E05（神经内分泌）、O01–O13（输入输出）的行为断言。
// 规矩：每条都是"给一个刺激 → 看字段/输出有没有按该有的方向动"，不看"字段在不在"。
//   node tests/fn-brainstem-endocrine-io.mjs
import { createEngine } from '../core/engine.js'
import { createBridge } from '../core/bridge.js'
import { render } from '../core/inject.js'

const T0 = new Date('2026-11-19T14:00:00+08:00').getTime()
const NIGHT = new Date('2026-11-19T03:00:00+08:00').getTime()

const mk = (persona = {}, t0 = T0) => {
  let t = t0
  const e = createEngine({ now: () => t, persona })
  return {
    e,
    now: () => t,
    go: (min = 1) => { t += min * 60_000 },
    say: (text) => e.tick([{ type: 'user', text, at: t }]),
    idle: (min = 1) => { t += min * 60_000; e.tick([]) },
  }
}

const bs = (e) => e.organs.brainstem.read()
const en = (e) => e.organs.endocrine.read()
const bi = (e) => e.organs.bias.read()
const io = (e) => e.read().io
const out = (e) => e.read().out || {}
const hypa = (e) => e.organs.hypothalamus.read()
const r2 = (n) => Math.round(Number(n) * 100) / 100
const mouth = (e) => render(e.read(), { hour: 14, tick: 0 }).split('\n').find(l => l.startsWith('嘴上')) || ''

let checks = 0
const fails = []
function ok(id, cond, detail = '') {
  checks += 1
  if (cond) console.log(`ok: ${id} ${detail}`)
  else { console.log(`FAIL ${id} ${detail}`); fails.push(`${id} ${detail}`) }
}
const PANIC = '闭嘴，滚，你别说话！！'
const PANIC2 = '滚蛋，你听见没有'
const HURT = '你不行，做不好，真让人失望'

// ═══════════ 表 9 · 脑干唤醒 ═══════════

// B01 呼吸节律：恐慌时频率 ×1.5（不是"意思一下"多喘两口）
{
  const calm = mk()
  calm.say('今天天气不错'); calm.go(1); calm.e.tick([])
  const base = bs(calm.e).respiration
  const pan = mk()
  pan.say(PANIC); pan.go(1); pan.say(PANIC2)
  const now = bs(pan.e).respiration
  const ratio = now / base
  ok('B01', ratio >= 1.45 && ratio <= 1.55 && now <= 30,
    `平静 ${r2(base)} 次/分 → 恐慌 ${r2(now)} 次/分 = ×${r2(ratio)}（要求 ×1.5）`)
}

// B02 心率：与自主神经联动 —— 交感上来心率跟着上，副交感回来心率跟着下
{
  const m = mk()
  m.say('今天下午三点开会'); m.go(5); m.e.tick([])
  const h0 = hypa(m.e).autonomic, r0 = bs(m.e).heartRate
  m.say(PANIC); m.go(1); m.say(PANIC2); m.go(1); m.e.tick([])
  const h1 = hypa(m.e).autonomic, r1 = bs(m.e).heartRate
  for (let i = 0; i < 8; i++) { m.go(5); m.e.tick([]) }
  const h2 = hypa(m.e).autonomic, r2v = bs(m.e).heartRate
  const up = h1.sym > h0.sym && r1 > r0
  const down = h2.par > h1.par && r2v < r1
  const inRange = [r0, r1, r2v].every(v => v >= 45 && v <= 140)
  ok('B02', up && down && inRange,
    `交感 ${r2(h0.sym)}→${r2(h1.sym)} 时心率 ${r2(r0)}→${r2(r1)}；副交感 ${r2(h1.par)}→${r2(h2.par)} 时回落到 ${r2(r2v)}`)
}

// B03 觉醒：低唤醒（缺觉）回复变慢
{
  const rested = mk(); rested.say('在吗')
  const tired = mk()
  const snap = tired.e.organs.hypothalamus.snapshot()
  snap.sleepDebt = 0.9
  tired.e.organs.hypothalamus.restore(snap)
  tired.say('在吗')
  const aR = bs(rested.e).arousal, aT = bs(tired.e).arousal
  const dR = io(rested.e).replyDelayMs, dT = io(tired.e).replyDelayMs
  ok('B03', aT < aR - 0.3 && dT >= dR * 1.3 && aT >= 0.05,
    `觉醒 睡饱 ${r2(aR)} / 熬夜缺觉 ${r2(aT)}；回复延迟 ${Math.round(dR)}ms → ${Math.round(dT)}ms = ×${r2(dT / dR)}`)
}

// B04 惊跳：突发消息短暂僵住（起得快、散得快，不是一直僵）
{
  const m = mk()
  m.say('今天下午开会')
  const s0 = bs(m.e).startle, stun0 = out(m.e).stunnedMs
  m.say(PANIC)
  const s1 = bs(m.e).startle, stun1 = out(m.e).stunnedMs, rate1 = io(m.e).voice.rate
  m.go(2); m.e.tick([])
  const s2 = bs(m.e).startle, stun2 = out(m.e).stunnedMs
  ok('B04', s0 <= 0.05 && s1 >= 0.3 && stun1 > 500 && s2 <= s1 * 0.5 && stun2 < stun1 && rate1 < 0.95,
    `惊跳 ${r2(s0)}→${r2(s1)}（僵住 ${stun0}→${stun1}ms，语速 ${r2(rate1)}），两分钟后 ${r2(s2)}/${stun2}ms`)
}

// B05 自主节律耦合：呼吸和心率同向走的时候，耦合度就该高
// 冲上顶的时候呼吸会先饱和（只剩心率在动），所以看"退下来"那一段：两条一起落。
{
  const m = mk()
  m.say(PANIC); m.go(1); m.say(PANIC2); m.go(2); m.e.tick([])
  const rows = []
  for (let i = 0; i < 5; i++) {
    m.go(3); m.e.tick([])
    rows.push({ resp: bs(m.e).respiration, hr: bs(m.e).heartRate, c: bs(m.e).coupling })
  }
  let pairs = 0, same = 0
  for (let i = 1; i < rows.length; i++) {
    const dR = rows[i].resp - rows[i - 1].resp
    const dH = rows[i].hr - rows[i - 1].hr
    if (Math.abs(dR) < 1e-6 || Math.abs(dH) < 1e-6) continue
    pairs += 1
    if (Math.sign(dR) === Math.sign(dH)) same += 1
  }
  const c = rows[rows.length - 1].c
  ok('B05', pairs >= 3 && same === pairs && c >= 0.6 && c <= 1,
    `缓和期呼吸心率同向 ${same}/${pairs} 拍，耦合度 ${r2(c)}（要求 ≥0.6）`)
}

// ═══════════ 表 11 · 神经内分泌 ═══════════

// E01 皮质醇：跟着 HPA 走（H06 的 8 分钟升 / 70 分钟退那条轴），压力上去它上去，压力过去它退下来
{
  const m = mk()
  m.say('今天周三'); m.go(1); m.e.tick([])
  const c0 = en(m.e).cortisol
  for (let i = 0; i < 5; i++) { m.say(PANIC); m.go(2) }
  const c1 = en(m.e).cortisol, h1 = hypa(m.e).hpa.cortisol
  for (let i = 0; i < 18; i++) { m.go(10); m.e.tick([]) }
  const c3 = en(m.e).cortisol, h3 = hypa(m.e).hpa.cortisol
  ok('E01', c1 >= c0 + 0.05 && c1 <= h1 + 0.05 && c3 < c1 && h3 < h1,
    `皮质醇 ${r2(c0)}→${r2(c1)}（HPA 同拍 ${r2(h1)}，慢半拍跟着）→ 三小时后 ${r2(c3)}（HPA ${r2(h3)}）`)
}

// E02 催产素：亲密后升，而且它把"中性话读成敌意"的门槛降下来（T05）
{
  const ctrl = mk(), warm = mk()
  for (let i = 0; i < 5; i++) { ctrl.say('今天周三这个参数怎么调'); ctrl.go(2) }
  for (let i = 0; i < 5; i++) { warm.say('谢谢你陪我，抱一下'); warm.go(2) }
  const o0 = en(ctrl.e).oxytocin, o1 = en(warm.e).oxytocin

  // 同一句中性冷话：催产素高的那边不该再判成挑衅
  const base = mk(); base.say('随便吧。')
  const hLow = bi(base.e).hostile
  const oxy = mk()
  const snap = oxy.e.organs.endocrine.snapshot(); snap.oxytocin = 0.85; oxy.e.organs.endocrine.restore(snap)
  oxy.say('随便吧。')
  const hHigh = bi(oxy.e).hostile
  ok('E02', o1 >= o0 + 0.04 && hHigh <= hLow - 0.1,
    `催产素 ${r2(o0)}→${r2(o1)}；同一句"随便吧"的敌意读数 ${r2(hLow)}→${r2(hHigh)}（门槛降了）`)
}

// E03 雌激素：经前一周的波动幅度 ×1.3（相位基调不变，是"更晃"不是"整体抬高"）
{
  const rows = []
  for (let day = 1; day <= 28; day++) {
    const start = T0 - (day - 1) * 86400_000
    const e = createEngine({ now: () => T0, persona: { cycle: { on: true, lastStart: start } } })
    e.tick([{ type: 'user', text: '今天周三', at: T0 }])
    rows.push({ day, est: en(e).estrogen })
  }
  const amp = (lo, hi) => {
    const v = rows.filter(r => r.day >= lo && r.day <= hi).map(r => r.est)
    return Math.max(...v) - Math.min(...v)
  }
  const normal = amp(8, 18), pre = amp(22, 28)
  const ratio = pre / normal
  ok('E03', ratio >= 1.2 && ratio <= 1.4 && pre > 0,
    `平常一周峰谷差 ${r2(normal)}，经前一周 ${r2(pre)} = ×${r2(ratio)}（要求 ×1.3）`)
}

// E04 睾酮：竞争失败后下降，恢复是小时量级
{
  const ctrl = mk()
  ctrl.say('今天周三'); ctrl.go(1); ctrl.e.tick([])
  const base = en(ctrl.e).testosterone
  const m = mk()
  for (let i = 0; i < 3; i++) { m.say('你输了，比不过他，你被淘汰了'); m.go(1) }
  const after = en(m.e).testosterone
  m.go(180); m.e.tick([])
  const back = en(m.e).testosterone
  ok('E04', after <= base - 0.08 && back >= after + 0.04 && back < base,
    `睾酮 ${r2(base)}→${r2(after)}（输了三次）→ 三小时后回到 ${r2(back)}`)
}

// E05 甲状腺：只做"长期低能量"标量 —— 一条消息不动它，熬三个小时才动，且真的影响语速
{
  const ctrl = mk(), stress = mk()
  const t0 = en(stress.e).thyroid
  stress.say(PANIC)
  const t1 = en(stress.e).thyroid
  for (let i = 0; i < 18; i++) {
    stress.say(PANIC2 + '，废物'); stress.go(10)
    ctrl.say('今天周三，下午三点开会'); ctrl.go(10)
  }
  const t2 = en(stress.e).thyroid, tc = en(ctrl.e).thyroid
  ok('E05', Math.abs(t1 - t0) < 0.005 && t2 <= tc - 0.02 && io(stress.e).voice.rate < io(ctrl.e).voice.rate,
    `甲状腺 ${r2(t0)}→一条消息后 ${r2(t1)}（几乎不动）→累三小时 ${r2(t2)} vs 对照 ${r2(tc)}；语速 ${r2(io(stress.e).voice.rate)} vs ${r2(io(ctrl.e).voice.rate)}`)
}

// ═══════════ 表 14 · 输入输出 ═══════════

// O01 输入偏置：心情差的时候，同一句话读出来的味道不一样
{
  const low = mk({ moodBase: -0.45 }), fair = mk({ moodBase: 0.1 })
  for (const m of [low, fair]) { m.say('今天周三，下午三点开会'); m.go(1); m.e.tick([]); m.say('今天周三，下午三点开会') }
  const negL = bi(low.e).neg, negF = bi(fair.e).neg
  const hostL = bi(low.e).hostile, hostF = bi(fair.e).hostile
  ok('O01', negL >= negF + 0.15 && hostL >= hostF + 0.05,
    `同一句中性话：负性偏置 ${r2(negF)}→${r2(negL)}，敌意读数 ${r2(hostF)}→${r2(hostL)}（心情 ${r2(fair.e.read().mood)} vs ${r2(low.e.read().mood)}）`)
}

// O02 敌意归因偏置：一句中性的冷话被判成挑衅，一句普通信息话不会
{
  const cold = mk(); cold.say('随便吧。')
  const plain = mk(); plain.say('今天周三，下午三点开会，别忘了')
  const hCold = bi(cold.e).hostile, hPlain = bi(plain.e).hostile
  ok('O02', hCold >= 0.5 && hPlain <= 0.35 && hCold >= hPlain + 0.25,
    `"随便吧。"被判挑衅 ${r2(hCold)}（≥0.5），普通信息句 ${r2(hPlain)}（≤0.35）`)
}

// O03 心境一致性记忆：同样的旧事，心情差时先想起负性的那条（M08 的提取偏置）
{
  const hits = [
    { id: 'p1', brief: '插件又崩了，后来修好了', valence: 0.5, score: 0.5 },
    { id: 'n1', brief: '插件又崩了，我砸了键盘', valence: -0.5, score: 0.5 },
  ]
  const run = (moodBase) => {
    const hip = { recallSync: () => ({ ok: true, hits: hits.map(h => ({ ...h })) }), write: () => null }
    const br = createBridge((id) => (id === 'memory.hippocampus' ? hip : null))
    let t = T0
    const e = createEngine({ now: () => t, bridge: br, persona: { moodBase } })
    e.tick([{ type: 'user', text: '插件又崩了', at: t }])
    const hitsNow = e.read().memoryEcho?.hits || []
    const first = hitsNow[0] || null
    const neg = hitsNow.find(h => h.id === 'n1') || null
    return { first, negScore: Number(neg?.score), congruent: e.organs.bias.read().congruent }
  }
  const bad = run(-0.5), good = run(0.5)
  const badNeg = Number(bad.first?.valence) < 0
  const goodPos = Number(good.first?.valence) > 0
  ok('O03', badNeg && goodPos && bad.negScore > good.negScore && bad.congruent > good.congruent,
    `同一批旧事：心情差时先想起负性那条（${r2(bad.first?.valence)}），心情好时先想起正性那条（${r2(good.first?.valence)}）；那条负性旧事的分 ${r2(good.negScore)}→${r2(bad.negScore)}；心境偏置 ${r2(bad.congruent)} vs ${r2(good.congruent)}`)
}

// O04 表达·措辞：冷 / 硬 / 软三档可辨（措辞档位、句号数、句长三样都不同）
{
  const cold = mk(); cold.say('哦。'); cold.go(1); cold.say('嗯。')
  const hard = mk(); hard.say('你这人说话真不靠谱'); hard.go(1); hard.say('闭嘴，别烦我')
  const soft = mk(); soft.say('对不起嘛，我错了'); soft.go(1); soft.say('别生气，抱一下')
  const sig = (m) => `${out(m.e).wording}|${out(m.e).marks.period}|${out(m.e).sentenceChars}`
  const [sc, sh, ss] = [sig(cold), sig(hard), sig(soft)]
  const distinct = new Set([sc, sh, ss]).size === 3
  const words = [out(cold.e).wording, out(hard.e).wording, out(soft.e).wording]
  ok('O04', distinct && words[0] === 'cold' && words[1] === 'hard' && words[2] === 'soft'
    && out(hard.e).marks.period > out(cold.e).marks.period
    && out(soft.e).sentenceChars > out(hard.e).sentenceChars,
    `冷 ${sc}（${mouth(cold.e)}）/ 硬 ${sh}（${mouth(hard.e)}）/ 软 ${ss}（${mouth(soft.e)}）`)
}

// O05 表达·句长：低落时一句短四成
{
  const low = mk({ moodBase: -0.45 }), fair = mk({ moodBase: 0.1 })
  for (const m of [low, fair]) { m.say('今天周三，下午三点开会'); m.go(1); m.e.tick([]); m.say('今天周三，下午三点开会') }
  const cLow = out(low.e).sentenceChars, cFair = out(fair.e).sentenceChars
  const ratio = cLow / cFair
  ok('O05', ratio <= 0.6 && io(low.e).brevity > io(fair.e).brevity,
    `同一句话：平常 ${cFair} 字 → 低落 ${cLow} 字 = ×${r2(ratio)}（要求 ≤0.6，即至少短四成）`)
}

// O06 表达·标点：生气句号增多（而且不带感叹号）
{
  const calm = mk(); calm.say('今天周三'); calm.go(1); calm.e.tick([])
  const angry = mk(); angry.say('你这人说话真不靠谱'); angry.go(1); angry.say('闭嘴，别烦我')
  const pC = out(calm.e).marks.period, pA = out(angry.e).marks.period
  ok('O06', pA > pC && io(angry.e).punctuation === 'flat' && out(angry.e).marks.exclaim <= out(calm.e).marks.exclaim,
    `句号 ${pC}→${pA} 个/句，标点档 ${io(calm.e).punctuation}→${io(angry.e).punctuation}，感叹号 ${out(calm.e).marks.exclaim}→${out(angry.e).marks.exclaim}`)
}

// O07 表达·延迟：生气当场是 1.5~4 倍；一直憋着封顶 6 分钟
{
  const calm = mk(); calm.say('今天周三')
  const angry = mk(); angry.say(PANIC)
  const d0 = io(calm.e).replyDelayMs, d1 = io(angry.e).replyDelayMs
  const ratio = d1 / d0
  let capped = 0
  for (let i = 0; i < 15; i++) { angry.say(PANIC2); angry.go(1); capped = io(angry.e).replyDelayMs }
  ok('O07', ratio >= 1.5 && ratio <= 4 && capped === 360_000 && d1 <= 360_000,
    `当场 ${Math.round(d0)}ms → ${Math.round(d1)}ms = ×${r2(ratio)}（1.5~4 倍）；憋十五分钟封顶 ${capped}ms (=6 分钟)`)
}

// O08 表达·表情包：低落时该少发、发也是丧的
{
  const sad = mk(); sad.say('我很难过，心里堵得慌，想哭')
  const happy = mk(); happy.say('太好了，谢谢你，我真开心')
  const pSad = io(sad.e).meme.probability, pHappy = io(happy.e).meme.probability
  ok('O08', pSad <= pHappy - 0.2 && io(sad.e).meme.style === 'emo' && io(happy.e).meme.style === 'bright',
    `低落 ${r2(pSad)}（${io(sad.e).meme.style}）vs 开心 ${r2(pHappy)}（${io(happy.e).meme.style}）`)
}

// O09 表达·语音（简）：只给语速/音量，但这两个得跟着状态动
{
  const low = mk({ moodBase: -0.45 }), fair = mk({ moodBase: 0.1 })
  for (const m of [low, fair]) { m.say('今天周三，下午三点开会'); m.go(1); m.e.tick([]) }
  const angry = mk(); angry.say('闭嘴，别烦我')
  const vLow = io(low.e).voice, vFair = io(fair.e).voice, vAng = io(angry.e).voice
  const inBand = (v) => v.rate >= 0.7 && v.rate <= 1.15 && v.volume >= 0.7 && v.volume <= 1.15
  ok('O09', vLow.rate <= vFair.rate - 0.03 && vAng.volume >= vFair.volume + 0.05 && [vLow, vFair, vAng].every(inBand),
    `语速 低落 ${r2(vLow.rate)} vs 平常 ${r2(vFair.rate)}；音量 生气 ${r2(vAng.volume)} vs 平常 ${r2(vFair.volume)}`)
}

// O10 抑制与泄漏：嘴上说"我没事"，语气是冲的
{
  const masked = mk()
  for (let i = 0; i < 2; i++) { masked.say(HURT); masked.go(1) }
  masked.say('我没事。')
  const gap = io(masked.e).selfReportGap
  const leak = masked.e.read().display.leakRisk
  const w = out(masked.e).wording
  ok('O10', gap >= 0.15 && leak >= 0.15 && (w === 'cold' || w === 'hard'),
    `"我没事。"：自报误差 ${r2(gap)}、泄漏 ${r2(leak)}、措辞 ${w}（压着但漏出来了）`)
}

// O11 表达后的释放：真说出来了，这一拍就轻一档（≥10%）
{
  const seq = (speak) => {
    const m = mk()
    m.say(HURT); m.go(1); m.e.tick([])
    if (speak) m.e.markSpoke()
    m.go(1); m.e.tick([])
    return { felt: m.e.organs.insula.read().felt.intensity, vent: io(m.e).venting }
  }
  const said = seq(true), held = seq(false)
  ok('O11', said.felt <= held.felt * 0.9 && said.vent > 0.15,
    `说出来后体内感 ${r2(said.felt)} vs 没说 ${r2(held.felt)}（降 ${r2((1 - said.felt / held.felt) * 100)}%），venting ${r2(said.vent)}`)
}

// O12 倾诉行为：难过的时候会主动找人说话
{
  const hurt = mk()
  for (let i = 0; i < 2; i++) { hurt.say(HURT); hurt.go(1) }
  const fine = mk(); fine.say('今天周三')
  const sH = io(hurt.e).seekComfort, sF = io(fine.e).seekComfort
  ok('O12', sH >= 0.45 && out(hurt.e).reachOut === true && out(fine.e).reachOut === false && sH >= sF + 0.3,
    `难过时倾诉 ${r2(sH)}（reachOut=${out(hurt.e).reachOut}），平常 ${r2(sF)}（reachOut=${out(fine.e).reachOut}）`)
}

// O13 自我报告准确度："我没事"能分得出来（同样的字，不同的里子）
{
  const masked = mk()
  for (let i = 0; i < 2; i++) { masked.say(HURT); masked.go(1) }
  masked.say('我没事。')
  const fine = mk(); fine.say('我没事。')
  const gM = io(masked.e).selfReportGap, gF = io(fine.e).selfReportGap
  ok('O13', gM >= 0.2 && gM >= gF * 2.5,
    `同一句"我没事"：心里有事 ${r2(gM)} vs 真没事 ${r2(gF)} = ×${r2(gM / Math.max(1e-6, gF))}`)
}

console.log('')
console.log(`断言 ${checks} 条，失败 ${fails.length} 条`)
if (fails.length) { for (const f of fails) console.log(' - ' + f); process.exit(1) }
process.exit(0)
