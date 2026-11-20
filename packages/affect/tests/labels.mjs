// 情绪标签：由她对这句话的评价决定，再带近期惯性。
// 情绪从她真正看到的注入文本里读（read() 里没有 emotions）。
//   node tests/labels.mjs
import { createEngine } from '../core/engine.js'

const fails = []
const ok = (c, m) => { if (!c) fails.push(m) }
const KINDS = ['委屈', '心痛', '厌烦', '生气', '失望', '难过', '焦虑', '紧张', '害怕', '内疚', '羞耻', '开心', '安心', '感动', '想念']

const mk = (t0 = new Date('2026-11-12T05:00:00+08:00').getTime()) => {
  let t = t0
  const e = createEngine({ now: () => t })
  return { e, go: (min = 1) => { t += min * 60_000 }, say: (text) => e.tick([{ type: 'user', text, at: t }]) }
}

const textOf = (e) => String(e.text?.() || '')
const mood = (e) => Number(e.state?.mood ?? 0)
const labels = (e) => {
  const line = textOf(e).split('\n').find((x) => x.startsWith('心里：')) || ''
  return KINDS.filter((k) => line.includes(k))
}
const calm = (w, n = 3) => { for (let i = 0; i < n; i += 1) { w.go(1); w.say('把 tests 跑一遍') } }

// 1. 纯技术对话：不该冒情绪标签
{
  const w = mk()
  for (const line of ['把 tests 全跑一遍', '这个函数在 204 行', '重启一下试试', '日志里没有报错', '再看一下 memory 页', 'curl 那个接口']) {
    w.go(1); w.say(line)
  }
  ok(labels(w.e).length === 0, `中性技术对话却出了情绪：${labels(w.e)}`)
}

// 2. 被骂：要出负性标签；心情要比"同样长度但没被骂"的对照低
{
  const w = mk()
  calm(w)
  const ctrl = mk()
  calm(ctrl)
  ctrl.go(1); ctrl.say('这个函数在 204 行')
  ctrl.go(1); ctrl.say('日志里没有报错')
  w.go(1); w.say('你这做的什么垃圾，全是错的，重写')
  w.go(1); w.say('看看你干的好事')
  const k = labels(w.e)
  ok(k.length > 0, '被骂了却没出情绪')
  ok(k.some((x) => ['委屈', '生气', '难过', '失望', '厌烦', '心痛'].includes(x)), `被骂出的不是负性：${k}`)
  ok(mood(w.e) < mood(ctrl.e) - 0.002, `被骂后心情该比对照低：${mood(w.e)} vs ${mood(ctrl.e)}`)
}

// 3. 惯性：被骂后一句中性还带余温；再过几拍只剩一条或没有，且不会同时挂两种负性
{
  const w = mk()
  calm(w)
  w.go(1); w.say('你这做的什么垃圾，全是错的，重写')
  const hot = labels(w.e)
  w.go(1); w.say('这个函数在 204 行')
  const linger = labels(w.e)
  for (let i = 0; i < 5; i += 1) { w.go(6); w.say('日志里没有报错') }
  const later = labels(w.e)
  ok(hot.length > 0, '被骂那拍没出情绪')
  ok(linger.length <= 1, `余温不该堆出很多标签：${linger}`)
  ok(later.length <= 1 && !(later.includes('心痛') && later.includes('厌烦')), `余温该散掉，实际：${later}`)
}

// 4. 安抚：负性该退，心情往上
{
  const w = mk()
  calm(w)
  w.go(1); w.say('你这做的什么垃圾，全是错的，重写')
  const bad = mood(w.e)
  w.go(1); w.say('对不起，是我说重了，别往心里去')
  w.go(1); w.say('刚才是我急了')
  const k = labels(w.e)
  ok(k.length === 0 || k.every((x) => !['委屈', '心痛', '厌烦', '生气', '失望'].includes(x)), `安抚后还挂着负性：${k}`)
  ok(mood(w.e) > bad, `安抚后心情该往上：${bad} → ${mood(w.e)}`)
}

if (fails.length) {
  console.log(`FAIL ${fails.length}:`)
  for (const f of fails) console.log(' - ' + f)
  process.exit(1)
}
console.log('PASS 情绪标签（中性不冒 / 被骂出负性且心情更低 / 惯性收敛 / 安抚转暖）')
process.exit(0)
