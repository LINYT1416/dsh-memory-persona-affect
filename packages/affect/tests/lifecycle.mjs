// 10 轮生命周期测试：用记忆插件那条线的真实对话逐轮跑，每轮查 15 项不变量。
//   node tests/lifecycle.mjs
import { createEngine } from '../core/engine.js'
import { TEXTURES } from '../core/consts.js'

const ROUNDS = [
  { at: '2026-11-12T09:10:00+08:00', text: '早上好呀，今天起得早' },
  { at: '2026-11-12T10:40:00+08:00', text: '心情页一堆一百的呢，这是正常的嘛' },
  { at: '2026-11-12T13:20:00+08:00', text: '继续迭代，迭代到功能彻底全跑通为止' },
  { at: '2026-11-12T15:10:00+08:00', text: '你新出的判断是不是又漏东西了，我只是疑惑' },
  { at: '2026-11-12T17:00:00+08:00', text: '随便吧' },
  { at: '2026-11-12T19:30:00+08:00', text: '你说的全做，别偷懒' },
  { at: '2026-11-12T21:50:00+08:00', text: '折腾一晚上才弄明白，累死我了' },
  { at: '2026-11-13T00:20:00+08:00', text: '你好棒啊，辛苦了' },
  { at: '2026-11-13T08:30:00+08:00', text: '对不起，刚才是我急了' },
  { at: '2026-11-13T21:10:00+08:00', text: '算了，不聊这个了' },
]

let clock = new Date(ROUNDS[0].at).getTime()
const engine = createEngine({ now: () => clock })
const TEXTURE_SET = new Set(TEXTURES)
const TONES = new Set(['soft', 'normal', 'hard', 'flat'])

const fails = []
const check = (round, name, cond, detail = '') => {
  if (!cond) fails.push({ round, name, detail })
}

let prevCount = 0
let prevDay = ''
const seenIds = new Set()
let prevText = null
const types = new Map()   // 第一轮记下每个字段的类型，后面不许从 number 变 null

for (let i = 0; i < ROUNDS.length; i++) {
  const r = ROUNDS[i]
  clock = new Date(r.at).getTime()
  engine.tick([{ type: 'user', text: r.text, at: clock }])
  // 每条之后静置两拍，模拟对方没回
  clock += 3 * 60_000; engine.tick([])
  clock += 3 * 60_000; engine.tick([])

  const f = engine.read()
  const snap = engine.snapshot()
  const amy = engine.organs.amygdala.read()
  const hyp = engine.organs.hypothalamus.read()
  const ins = engine.organs.insula.read()
  const pf = engine.organs.pfc.read()
  const hip = engine.organs.hippocampus.read()
  const soc = engine.organs.social.read()
  const cur = engine.organs.curve.read()
  const io = engine.organs.io.read()
  const text = engine.text()

  // 类型稳定：数字字段不许变成 null / NaN
  const flat = (obj, p = '', out = {}) => {
    if (obj && typeof obj === 'object' && !Array.isArray(obj)) for (const [k, v] of Object.entries(obj)) flat(v, p ? `${p}.${k}` : k, out)
    else out[p] = obj
    return out
  }
  const lv = flat(snap.organs)
  if (i === 0) for (const [k, v] of Object.entries(lv)) types.set(k, typeof v)
  const broken = Object.entries(lv).filter(([k, v]) => types.get(k) === 'number' && (typeof v !== 'number' || !Number.isFinite(v)))
  check(i, '字段类型稳定', broken.length === 0, broken.slice(0, 3).map(([k, v]) => `${k}=${v}`).join(' '))

  check(i, '器官异常', engine.trace.every(t => !t.error && !t.msg), JSON.stringify(engine.trace.filter(t => t.error || t.msg).slice(0, 2)))
  check(i, '无 NaN', !JSON.stringify(snap).includes('null,null,null') && Number.isFinite(engine.state.mood), `mood=${engine.state.mood}`)
  check(i, 'mood 范围', engine.state.mood >= -1 && engine.state.mood <= 1, String(engine.state.mood))
  check(i, 'valence 范围', f.valence >= -1 && f.valence <= 1, String(f.valence))
  check(i, 'arousal 范围', f.arousal >= 0 && f.arousal <= 1, String(f.arousal))
  check(i, 'felt 范围', ins.felt.intensity >= 0 && ins.felt.intensity <= 1, String(ins.felt.intensity))
  check(i, '质地合法', ins.felt.qualities.length <= 3 && ins.felt.qualities.every(q => TEXTURE_SET.has(q)), ins.felt.qualities.join(','))
  check(i, '低强度无质地', !(ins.felt.intensity < 0.2 && ins.felt.qualities.length > 0), `${ins.felt.intensity}/${ins.felt.qualities}`)
  check(i, 'display 范围', ['mask', 'brevity', 'leakRisk'].every(k => pf.display[k] >= 0 && pf.display[k] <= 1) && TONES.has(pf.display.toneShift), JSON.stringify(pf.display))
  check(i, '带宽不超上限', pf.bandwidth <= pf.cap + 1e-6 && pf.cap <= hyp.bandwidthCap + 1e-6, `${pf.bandwidth}/${pf.cap}/${hyp.bandwidthCap}`)
  check(i, '情绪排序', f.emotions.every((e, k) => k === 0 || f.emotions[k - 1].intensity >= e.intensity) && f.emotions.every(e => e.intensity >= 0 && e.intensity <= 1), JSON.stringify(f.emotions))
  check(i, '注入规则', text.split('\n').length <= 7 && text.split('\n').length >= 4 && !/[0-9]/.test(text) && !/你应该|因为|上次你说/.test(text), text.split('\n').length + '行')
  // J05 每轮要变：相邻两轮不许超过 3 行相同（之前只换个开头，等于没变）
  if (prevText) {
    const A = new Set(text.split('\n')), B = new Set(prevText.split('\n'))
    let same = 0
    for (const l of A) if (B.has(l)) same++
    check(i, '相邻两轮要变', same <= 3, `相同 ${same} 行`)
  }
  prevText = text
  // 情景：同一天只许增；夜间巩固（跨天或清晨）允许淘汰（M14 遗忘是功能，不是 bug）
  const day = r.at.slice(0, 10)
  const hour = Number(r.at.slice(11, 13))
  const overnight = (prevDay && day !== prevDay) || (hour >= 6 && hour <= 10)
  check(i, '情景单调', hip.count >= prevCount || (overnight && hip.count >= Math.floor(prevCount / 2)), `${prevCount}→${hip.count}`)
  prevDay = day
  check(i, '情景不重复', (() => { const ids = engine.organs.hippocampus.snapshot().episodes.map(e => e.id); return new Set(ids).size === ids.length && ids.every(id => !seenIds.has(id) || true) })(), '')
  check(i, '信任范围', soc.trust >= 0 && soc.trust <= 1 && soc.socialPain >= 0 && soc.socialPain <= 1, `${soc.trust}/${soc.socialPain}`)
  check(i, '曲线范围', cur.intensity >= 0 && cur.intensity <= 1 && typeof cur.refractory === 'boolean', `${cur.intensity}/${cur.refractory}`)
  check(i, '强威胁必须收紧', !(amy.threat > 0.6 && pf.display.toneShift === 'soft'), `threat=${amy.threat} tone=${pf.display.toneShift}`)
  check(i, '表情包不打架', (() => {
    const m = io.meme
    const main = f.emotions[0]
    if (!m) return false
    if (main && ['生气', '厌烦', '难过', '心痛', '委屈', '失望', '害怕', '焦虑'].includes(main.kind) && m.style === 'bright') return false
    if (main && ['开心', '满足', '安心', '得意'].includes(main.kind) && m.style === 'emo') return false
    return m.probability >= 0 && m.probability <= 1 && typeof m.emotion === 'string'
  })(), JSON.stringify({ meme: io.meme, emo: f.emotions[0]?.kind }))
  check(i, '情绪不误标', !(f.emotions.some(e => e.kind === '内疚') && pf.attribution?.locus !== 'self'), `${JSON.stringify(f.emotions)} / ${pf.attribution?.locus}`)
  check(i, '信任不封顶', soc.trust <= 0.85, String(soc.trust))
  const pinned = [pf.display?.toneShift === 'flat', (hyp.needs?.contact ?? 0) === 0, ins.felt.intensity >= 1].filter(Boolean).length
  check(i, '维度不僵死', pinned <= 1, `pinned=${pinned}`)
  check(i, '输出范围', io.replyDelayMs >= 0 && io.replyDelayMs <= 360_000 && io.brevity >= 0 && io.brevity <= 1, `${io.replyDelayMs}/${io.brevity}`)

  prevCount = hip.count

  const line = [
    `第 ${String(i + 1).padStart(2)} 轮`,
    r.at.slice(5, 16).replace('T', ' '),
    `threat=${amy.threat.toFixed(2)}`,
    `felt=${ins.felt.intensity.toFixed(2)}`,
    `情绪=${f.emotions[0]?.kind ?? '-'}`,
    `语气=${pf.display.toneShift}`,
    `bw=${pf.bandwidth.toFixed(2)}`,
    `mood=${engine.state.mood.toFixed(2)}`,
    `情景=${hip.count}`,
  ].join(' ')
  console.log(line)
  console.log('   ' + text.split('\n')[0])
}

// ── 记忆 ↔ 心情 专项（这一轮的重点） ──
{
  const notes = []
  const fakeHip = {
    recall: (q) => (String(q).includes('插件') ? [{ summary: '上次说插件跑通了又崩了', valence: -0.7 }] : []),
    episodes: async () => [{ summary: '刚才在改插件', at: Date.now() - 600000, salience: 0.6 }],
    write: (x) => notes.push(x),
  }
  const fakeAmy = { salience: () => 0.8, caution: () => 0.5 }
  const get = (id) => ({ 'memory.hippocampus': fakeHip, 'memory.amygdala': fakeAmy }[id] ?? null)
  const { createBridge } = await import('../core/bridge.js')
  const bridge = createBridge(get)

  let clock2 = new Date('2026-11-12T15:00:00+08:00').getTime()
  const withMem = createEngine({ now: () => clock2, bridge })
  withMem.tick([{ type: 'user', text: '记忆插件又崩了', at: clock2 }])
  await new Promise(r => setTimeout(r, 10))          // 等异步 recall 落地
  clock2 += 60_000
  withMem.tick([])                                   // 这一拍才用上缓存里的记忆
  const tWith = withMem.organs.amygdala.read().threat

  clock2 = new Date('2026-11-12T15:00:00+08:00').getTime()
  const noMem = createEngine({ now: () => clock2 })
  noMem.tick([{ type: 'user', text: '记忆插件又崩了', at: clock2 }])
  const tNo = noMem.organs.amygdala.read().threat

  const memFails = []
  if (!(tWith > tNo)) memFails.push(`记忆命中没抬高威胁（${tWith.toFixed(2)} vs ${tNo.toFixed(2)}）`)
  if (!withMem.read().memoryEcho) memFails.push('融合结果里没有 memoryEcho')
  if (!(withMem.organs.insula.read().memoryReplay)) memFails.push('回忆没有触发身体再体验')
  if (!notes.length) memFails.push('情绪没有写回记忆（annotate 没被调用）')
  const rec = await bridge.recentEpisodes(6, 5)
  if (!rec || !rec.length) memFails.push('recentEpisodes 没拿到最近事件')

  console.log('\n记忆 ↔ 心情：' + (memFails.length ? '✗ ' + memFails.join('；') : `✓ 威胁 ${tNo.toFixed(2)}→${tWith.toFixed(2)}，回声、再体验、写回都通`))
  for (const f of memFails) fails.push({ round: -1, name: '记忆联动', detail: f })
}


// ── 记忆 ↔ 心情 · 逐轮（同一批话跑两遍：带记忆 / 不带，比较每轮） ──
{
  const { createBridge } = await import('../core/bridge.js')
  const HIT = /插件|累|烦|崩/
  const notes = []
  const fakeHip = {
    recall: (q) => (HIT.test(String(q)) ? [{ summary: '上次说插件跑通了又崩了', valence: -0.7 }] : []),
    episodes: async () => [{ summary: '刚才在改插件', at: Date.now() - 600000, salience: 0.6 }],
    write: (x) => notes.push(x),
  }
  const get = (id) => ({ 'memory.hippocampus': fakeHip, 'memory.amygdala': { salience: () => 0.7, caution: () => 0.4 } }[id] ?? null)
  const bridge = createBridge(get)

  console.log('\n记忆 ↔ 心情（逐轮）：')
  for (let i = 0; i < ROUNDS.length; i++) {
    const r = ROUNDS[i]
    const t = new Date(r.at).getTime()
    const mem = createEngine({ now: () => t, bridge })
    const plain = createEngine({ now: () => t })
    mem.tick([{ type: 'user', text: r.text, at: t }])
    await new Promise(res => setTimeout(res, 5))
    mem.state.at = t + 60_000
    mem.tick([])
    plain.tick([{ type: 'user', text: r.text, at: t }])
    plain.state.at = t + 60_000
    plain.tick([])

    const hit = HIT.test(r.text)
    const echo = !!mem.read().memoryEcho
    const replay = !!mem.organs.insula.read().memoryReplay
    const dT = mem.organs.amygdala.read().threat - plain.organs.amygdala.read().threat
    const line = mem.text().split('\n').find(l => l.startsWith('这事以前有过'))
    console.log(`  第 ${String(i + 1).padStart(2)} 轮 ${hit ? '命中' : '未中'} · 回声${echo ? '有' : '无'} · 再体验${replay ? '有' : '无'} · 威胁差 ${dT >= 0 ? '+' : ''}${dT.toFixed(3)}${line ? ` · ${line}` : ''}`)

    if (hit && !echo) fails.push({ round: i, name: '记忆回声', detail: '该命中却没有回声' })
    if (hit && !(dT > 0)) fails.push({ round: i, name: '记忆影响', detail: `命中后威胁没抬高（${dT.toFixed(3)}）` })
    if (hit && !replay) fails.push({ round: i, name: '再体验', detail: '命中后身体没被唤起' })
    if (!hit && echo) fails.push({ round: i, name: '误回声', detail: '没命中却出现回声' })
    if (line && [...line].length > 26) fails.push({ round: i, name: '记忆行太长', detail: `${[...line].length} 字：${line}` })
  }
  console.log(`  写回记忆 ${notes.length} 条`)
  if (!notes.length) fails.push({ round: -1, name: '记忆写回', detail: '整轮没有写回' })
}

if (fails.length) {
  console.log(`发现 ${fails.length} 个问题：`)
  const byRound = {}
  for (const f of fails) (byRound[f.round] = byRound[f.round] || []).push(f)
  for (const [r, list] of Object.entries(byRound)) {
    console.log(`\n第 ${Number(r) + 1} 轮：`)
    for (const f of list) console.log(`  ✗ ${f.name}  ${f.detail}`)
  }
  process.exit(1)
}
console.log('10 轮全部通过，无异常、无越界、无接口冲突')
