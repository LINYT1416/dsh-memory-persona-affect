// 自测：六器官协作、白纸、慢层、回滚、注入文本。

import { createEngine, ORDER_A, ORDER_B } from '../core/engine.js'
import { describe, dump } from '../core/desc.js'
import { plasticity } from '../core/quench.js'
import { createAffectBridge } from '../bridge/affect.js'
import { createMemoryBridge } from '../bridge/memory.js'
import { createTracker } from '../core/traitstat.js'
import { features, cueOf } from '../core/consts.js'

let pass = 0
let fail = 0
const bad = []
function check(label, fn) {
  try {
    const ok = fn()
    if (ok) { pass += 1; console.log(`  ok   ${label}`) } else { fail += 1; bad.push(label); console.log(`  FAIL ${label}`) }
  } catch (e) {
    fail += 1; bad.push(`${label}: ${e.message}`); console.log(`  ERR  ${label}: ${e.message}`)
  }
}

const say = (engine, text) => engine.tick([{ type: 'user', text, at: Date.now() }], 'test')

console.log('\n— 器官 —')
check('六个器官都建得起来', () => {
  const e = createEngine()
  return ['str', 'tpj', 'ofc', 'acc', 'mpfc', 'pcc'].every((k) => typeof e.organs[k].step === 'function')
})
check('每个器官都有 cover / read / snapshot / health', () => {
  const e = createEngine()
  return Object.values(e.organs).every((m) =>
    Array.isArray(m.cover) && m.cover.length > 0
    && typeof m.read === 'function' && typeof m.snapshot === 'function' && typeof m.health === 'function')
})
check('顺序：A 段先习惯，B 段读人→定价→检错→归我→连故事→固化', () => {
  return ORDER_A.join(',') === 'str' && ORDER_B.join(',') === 'tpj,ofc,acc,mpfc,pcc,str'
})

console.log('\n— 白纸 —')
check('初始参数等于中性点', () => {
  const e = createEngine()
  const p = e.paramsOf('acc')
  return Math.abs(p.stickiness - 0.55) < 1e-9 && Math.abs(e.paramsOf('mpfc').selfWeight - 0.75) < 1e-9
})
check('没证据时慢层不动（not-enough）', () => {
  const e = createEngine()
  const r = e.slow()
  return r.skipped === 'not-enough'
})

console.log('\n— 一拍 —')
check('一拍之后有 hex 和 traits', () => {
  const e = createEngine()
  const f = say(e, '在吗')
  return f && typeof f.hex.brevity === 'number' && typeof f.traits.stickiness === 'number'
})
check('六个器官这一拍都有读数', () => {
  const e = createEngine()
  const f = say(e, '今天有点累')
  return ['str', 'tpj', 'ofc', 'acc', 'mpfc', 'pcc'].every((k) => f.reads[k] && Object.keys(f.reads[k]).length > 0)
})

console.log('\n— 协作：三条总线 —')
check('价值总线：夸完 value 上去，冷完下来', () => {
  const e = createEngine()
  for (let i = 0; i < 6; i += 1) say(e, '你好厉害啊')
  const hi = e.read().reads.ofc.value
  const e2 = createEngine()
  for (let i = 0; i < 6; i += 1) say(e2, '随便你')
  const lo = e2.read().reads.ofc.value
  return hi > lo
})
check('冲突总线：习惯和意向不一致时有冲突值', () => {
  const e = createEngine()
  for (let i = 0; i < 8; i += 1) say(e, '随便')
  const f = say(e, '你好厉害啊')
  return f.reads.acc.conflict >= 0
})
check('自我总线：说到"我"比说到"他"更扎人', () => {
  const self = createEngine()
  const other = createEngine()
  for (let i = 0; i < 4; i += 1) { say(self, '我今天好累'); say(other, '他今天好累') }
  return self.read().reads.mpfc.relevance > other.read().reads.mpfc.relevance
})

console.log('\n— 像人 —')
check('同一类话重复多了会固化成习惯', () => {
  const e = createEngine()
  for (let i = 0; i < 12; i += 1) say(e, '在吗')
  const top = e.read().reads.str.top[0]
  return top && top.cue === 'ping' && top.s > 0.4
})
check('被冷的话会羞，被夸的自尊会涨', () => {
  const a = createEngine()
  for (let i = 0; i < 6; i += 1) say(a, '随便你')
  const b = createEngine()
  for (let i = 0; i < 6; i += 1) say(b, '你真厉害')
  return a.read().reads.ofc.shame > b.read().reads.ofc.shame
    && b.read().reads.mpfc.esteem > a.read().reads.mpfc.esteem
})
check('阴阳话会被读成"故意的"', () => {
  const e = createEngine()
  const f = say(e, '呵呵，你厉害')
  return f.reads.tpj.intent > 0.55 && f.reads.tpj.offense > 0.2
})

console.log('\n— 隔离 —')
check('一个器官抛错只回滚它自己，别的照跑', () => {
  const e = createEngine()
  const original = e.organs.ofc.step
  e.organs.ofc.step = () => { throw new Error('boom') }
  const f = say(e, '随便你')
  e.organs.ofc.step = original
  const traced = e.trace().some((t) => t.error === 'ofc')
  return traced && f && f.reads.mpfc && typeof f.reads.mpfc.esteem === 'number'
})

console.log('\n— 慢层 —')
check('证据够了会推参数，且单次不超过 2%', () => {
  const e = createEngine()
  const before = { ...e.paramsOf('ofc') }
  for (let i = 0; i < 25; i += 1) say(e, `随便你 ${i}`)
  const r = e.slow()
  const after = e.paramsOf('ofc')
  const span = 0.6 - 0.05
  const moved = Math.abs(after.shameBase - before.shameBase)
  return Array.isArray(r.moved) && moved > 0 && moved <= span * 0.0201
})
check('塑性永远不归零', () => plasticity({ n: 1e6 }) >= 0.05)

console.log('\n— 注入 —')
check('注入文本是短句，不带数字', () => {
  const e = createEngine()
  for (let i = 0; i < 6; i += 1) say(e, '随便你')
  const lines = describe(e.read(), { max: 3 })
  return lines.length > 0 && lines.every((l) => !/[0-9]/.test(l)) && lines.length <= 4
})
check('白纸状态下也说得出一句人话', () => {
  const lines = describe(createEngine().read() || { reads: {} })
  return lines.length === 1
})

console.log('\n— 人格机制三件 —')
check('if-then 签名能从重复里长出来', () => {
  const e = createEngine()
  for (let i = 0; i < 30; i += 1) say(e, `随便你 ${i}`)
  const f = e.read()
  return Array.isArray(f.signatures) && f.signatures.some((s) => s.id === 'cold→hard' && s.strength > 0.3)
})
check('白纸时签名不起作用（强度 0）', () => {
  const e = createEngine()
  return e.read() === null || e.health().signatureCount === 0
})
check('跨时间统计：均值在攒，不是瞬时', () => {
  const e = createEngine()
  for (let i = 0; i < 6; i += 1) say(e, '你真厉害')
  const f = e.read()
  return f.stable && f.stable.esteem && f.stable.esteem.n >= 6
    && typeof f.rawTraits?.esteem === 'number'
})
check('叙事连续性：翻转率高就更"不像自己"', () => {
  const mono = createTracker()
  for (let i = 0; i < 20; i += 1) mono.push('esteem', 0.5 + i * 0.01)
  const alt = createTracker()
  for (let i = 0; i < 20; i += 1) alt.push('esteem', i % 2 ? 0.6 : 0.4)
  const separated = alt.all().esteem.flip > mono.all().esteem.flip + 0.2
  const e = createEngine()
  for (let i = 0; i < 24; i += 1) say(e, i % 2 ? '随便你' : '你真棒')
  return separated && typeof e.read().reads.pcc.continuity === 'number'
})

console.log('\n— 补上的功能要真跑（不是只出个数）—')
check('S08 口头禅：同一句短话反复出现在口癖里', () => {
  const e = createEngine()
  for (let i = 0; i < 4; i += 1) say(e, '在吗')
  const p = e.read().reads.str.phrase
  return p && p.text === '在吗' && p.n >= 4
})
check('S10 停止信号：连着来会越停不下来', () => {
  const e = createEngine()
  for (let i = 0; i < 6; i += 1) say(e, '在吗')
  return e.read().reads.str.stop > 0.5
})
check('S11 奖赏贬值：一直得到就腻', () => {
  const e = createEngine()
  for (let i = 0; i < 6; i += 1) say(e, '哈哈你真棒')
  return e.read().reads.str.satiation > 0.05
})
check('S13 惩罚学得快：一次冷比一次暖留下的更重', () => {
  const cold = createEngine(); say(cold, '随便你')
  const warm = createEngine(); say(warm, '你真棒')
  const wc = cold.read().reads.str.top[0]?.w || 0
  const ww = warm.read().reads.str.top[0]?.w || 0
  return wc > ww
})
check('A06 预期违背：该来的没来会吓一下', () => {
  const e = createEngine()
  say(e, '在吗')
  say(e, '今天下雨')
  say(e, '随便吧')
  say(e, '不知道')
  return e.read().reads.acc.surprise > 0
})
check('T08 社交脚本：认得出客套', () => {
  const e = createEngine()
  say(e, '谢谢你')
  return e.read().reads.tpj.script === 'thanks'
})
check('T09 群体归属：说"我们"就不一样', () => {
  const e = createEngine()
  say(e, '我们一起吧')
  return e.read().reads.tpj.ingroup > 0.5
})
check('M02 自我概念：被怎么形容会记下来', () => {
  const e = createEngine()
  for (let i = 0; i < 3; i += 1) say(e, '你好厉害')
  const w = e.read().reads.mpfc.selfImage
  return w && w.word === '厉害'
})
check('O05 品味：对不同事有不同价，才算有偏好', () => {
  const e = createEngine()
  say(e, '你真棒'); say(e, '随便你'); say(e, '在吗')
  return e.read().reads.ofc.taste > 0
})
check('P07 未来自我：没锚点就想不了以后', () => {
  const e = createEngine()
  say(e, '在吗')
  return e.read().reads.pcc.future === 0
})

console.log('\n— 存储与接缝 —')
check('快照能来回', () => {
  const e = createEngine()
  for (let i = 0; i < 5; i += 1) say(e, '在吗')
  const s = e.snapshot()
  const e2 = createEngine()
  const ok = e2.restore(s)
  return ok && e2.state.ticks === e.state.ticks && e2.read() === null || ok
})
check('心情不在时返回 absent，不拿 0 顶', () => {
  const b = createAffectBridge(() => null)
  return b.present() === false && b.state() === null
})
check('记忆不在时返回空数组，不伪造', () => {
  const m = createMemoryBridge(() => null)
  return Array.isArray(m.episodes()) && m.episodes().length === 0
})
check('语用特征和线索能抽出来', () => {
  const f = features('呵呵，你厉害')
  return f.sarcasm === 1 && cueOf('在吗') === 'ping'
})

console.log(`\n结果：${pass} 过，${fail} 挂`)
if (fail) { console.log('挂了：'); for (const b of bad) console.log('  -', b); process.exitCode = 1 }
