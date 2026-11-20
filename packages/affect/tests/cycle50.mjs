// 50 轮全心情周期：每轮都过一个"像人+仪表页"的体检，发现问题直接打印轮次。
//   node tests/cycle50.mjs
import { createEngine } from '../core/engine.js'
import { render } from '../core/inject.js'
import { summarize } from '../core/dashboard.js'

const bad = []
const warn = []
const add = (r, m) => bad.push(`第 ${r} 轮：${m}`)

// 50 轮的台词：冷、暖、中性、沉默、深夜、夸、损、赶时间混着来
const SCRIPT = [
  '你行不行啊，说了几遍还是崩', '算了，我自己来', '今天天气不错', '嗯',
  '谢谢你，这次真的稳', '在忙吗', '先不说了，我要出门', '你又忘了',
  '别急，慢慢来', '随便吧', '这个参数是多少', '我有点难过',
  '抱一下', '你也没那么差', '快点，来不及了', '哈哈哈哈哈',
  '这有什么难的', '我不想聊了', '晚安', '早',
  '帮我看下这个报错', '算了不怪你', '你是不是傻', '辛苦了',
  '再改一版', '行吧', '我信你', '别闹',
  '这个月第三次了', '你能不能靠谱点', '吃了吗', '我想你了',
  '别贫', '说正事', '好累', '我先睡会儿',
  '刚忙完', '你继续', '做完了吗', '还差一点',
  '真受不了', '冷静点', '慢慢说', '我在听',
  '早说啊', '不用了', '下次吧', '就这样',
  '最后一遍', '行了',
]

let t = new Date('2026-11-18T20:00:00+08:00').getTime()
const e = createEngine({ now: () => t })
let prevMood = e.state.mood
let prevText = ''

for (let r = 0; r < SCRIPT.length; r++) {
  const text = SCRIPT[r]
  t += (r % 5 === 4 ? 25 : 3) * 60_000
  e.tick([{ type: 'user', text, at: t }])
  const f = e.read()

  // 基本域
  if (!Number.isFinite(f.mood) || f.mood < -1 || f.mood > 1) add(r + 1, `心情越界 ${f.mood}`)
  if (!Number.isFinite(f.arousal) || f.arousal < 0 || f.arousal > 1) add(r + 1, `唤醒越界 ${f.arousal}`)
  for (const em of f.emotions || []) {
    if (!Number.isFinite(em.intensity) || em.intensity < 0 || em.intensity > 1) add(r + 1, `情绪强度越界 ${em.kind}:${em.intensity}`)
  }
  // 共存必须有主次、不许并列
  for (let i = 1; i < (f.emotions || []).length; i++) {
    if (!(f.emotions[i].intensity < f.emotions[i - 1].intensity)) add(r + 1, `共存情绪没主次 ${f.emotions.map(x => x.kind + x.intensity.toFixed(2)).join(' ')}`)
  }
  // 负性场景不能出正面情绪
  const NEG = new Set(['心痛', '委屈', '厌烦', '生气', '失望', '焦虑', '内疚', '羞耻', '害怕', '紧张'])
  if ((f.appraisal?.goal ?? 0) < -0.2 && (f.emotions || []).some(x => !NEG.has(x.kind))) {
    add(r + 1, `负性场景出了正面情绪 ${f.emotions.map(x => x.kind)}`)
  }

  // 注入
  const txt = render(f, { hour: 21, tick: r })
  const lines = txt.split('\n').filter(Boolean)
  if (lines.length < 4 || lines.length > 12) add(r + 1, `注入行数 ${lines.length}`)
  if (/[0-9]/.test(txt.replace(/这事以前有过.*|上次好像也这样.*/g, ''))) add(r + 1, '注入里出现阿拉伯数字')
  if (txt === prevText) add(r + 1, '注入跟上一轮一字不差')

  // 仪表页
  const d = summarize(e)
  if (!d || !Array.isArray(d.dimensions) || d.dimensions.length !== 10) add(r + 1, '仪表页维度不是 10 个')
  if (!Array.isArray(d.coexist)) add(r + 1, '仪表页缺 coexist')
  if (!Array.isArray(d.organVoice) || d.organVoice.length < 6) add(r + 1, '仪表页器官声音不足 6 条')
  for (const v of d.organVoice || []) {
    if (!v.organ || typeof v.text !== 'string' || !v.text) add(r + 1, `器官声音空：${JSON.stringify(v)}`)
    if (!Number.isFinite(v.v) || v.v < 0 || v.v > 100) add(r + 1, `器官声音刻度越界 ${v.organ}:${v.v}`)
  }
  for (const c of d.coexist || []) {
    if (!c.kind || !Number.isFinite(c.intensity)) add(r + 1, `coexist 坏值 ${JSON.stringify(c)}`)
  }
  if ((d.coexist || []).length && d.coexist[0].role !== '主') add(r + 1, 'coexist 第一条不是主')

  // 输出通道
  if (!(f.io?.brevity > 0 && f.io?.brevity < 1)) add(r + 1, `句长越界 ${f.io?.brevity}`)
  if (!(f.io?.meme?.probability >= 0 && f.io?.meme?.probability <= 1)) add(r + 1, `表情包概率越界 ${f.io?.meme?.probability}`)
  if (f.display?.mask < 0 || f.display?.mask > 1) add(r + 1, `面具越界 ${f.display?.mask}`)

  // 像人：好话该把心情往上带，坏话该往下带（只查明显的）
  const good = /谢谢|辛苦了|稳|抱一下|信你|想你|晚安|早|不错|慢慢来/.test(text)
  const worse = /行不行|又忘|傻|受不了|第三次|靠谱|算了|随便吧|不想聊/.test(text)
  if (good && f.mood < prevMood - 0.08 && (f.appraisal?.goal ?? 0) > -0.1) warn.push(`第 ${r + 1} 轮：好话把心情压下去了（${prevMood.toFixed(2)}→${f.mood.toFixed(2)}）`)
  if (worse && f.mood > prevMood + 0.08) warn.push(`第 ${r + 1} 轮：坏话反而把心情抬上去了（${prevMood.toFixed(2)}→${f.mood.toFixed(2)}）`)

  if (process.env.CYCLE_VERBOSE) console.log(String(r + 1).padStart(2) + ' ' + text.slice(0, 12).padEnd(14) + ' mood=' + f.mood.toFixed(2) + ' emo=' + (f.emotions || []).map(x => x.kind + x.intensity.toFixed(2)).join('/'));
  prevMood = f.mood
  prevText = txt
}

// 收尾检查：50 轮之后不能还在极端值上，也不能一路不恢复
if (e.state.mood <= -0.9) warn.push(`五十轮后心情仍贴底（${e.state.mood.toFixed(2)}）`)
if (e.state.mood >= 0.9) warn.push(`五十轮后心情贴顶（${e.state.mood.toFixed(2)}）`)

const tail = warn.slice(0, 10).join('\n- ')
if (bad.length) {
  console.log(`FAIL ${bad.length}:\n- ${bad.slice(0, 15).join('\n- ')}`)
  if (warn.length) console.log(`另有提醒 ${warn.length}:\n- ${tail}`)
  process.exit(1)
}
if (warn.length) {
  console.log(`PASS（有 ${warn.length} 条提醒，不影响通过）:\n- ${tail}`)
} else {
  console.log('PASS 五十轮：域、主次、注入、仪表页、输出通道、心情方向全部正常')
}
process.exit(0)

