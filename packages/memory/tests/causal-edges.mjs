// 因果/转折/结果边：只在一段之内连，不瞎连。
import { buildCausal, buildCausalFromParts } from '../organs/hippocampus/lib/causal.js'

let fail = 0
const ok = (c, m) => { if (!c) { fail++; console.log('FAIL', m) } }

// 1) 因为…所以：一条因果
const t1 = '打印机卡纸了。因为我没插好纸。所以它一直报错。'
const e1 = buildCausal(t1)
ok(e1.length >= 2, `应该抓到至少 2 条关系，实际 ${e1.length}`)
ok(e1[0].type === 'cause' && e1[0].cue === '因为', `第一条应是 cause/因为，实际 ${e1[0]?.type}/${e1[0]?.cue}`)
ok(e1[1].type === 'result' && e1[1].cue === '所以', `第二条应是 result/所以，实际 ${e1[1]?.type}/${e1[1]?.cue}`)
ok(e1[0].from === 0 && e1[0].to === 1, '边要指向相邻两句')

// 2) 转折
const e2 = buildCausal('我本来以为能跑通。但是它崩了。')
ok(e2.length === 1 && e2[0].type === 'turn', `应抓到 1 条 turn，实际 ${JSON.stringify(e2)}`)

// 3) 纯叙述不该误报
const e3 = buildCausal('今天天气不错。我去公司了。下午开会。晚上回家。')
ok(e3.length === 0, `不该抓出关系，实际 ${JSON.stringify(e3)}`)

// 4) 短句过滤：太短的不成句
const e4 = buildCausal('嗯。好。所以。')
ok(e4.length === 0, `碎句不该成边，实际 ${JSON.stringify(e4)}`)

// 5) 上限
const many = Array.from({ length: 12 }, (_, i) => `这是第${i}句话内容。因为第${i}句话有原因。`).join('')
ok(buildCausal(many).length <= 5, `最多 5 条，实际 ${buildCausal(many).length}`)

// 6) 单句无关系词
ok(buildCausal('我今天吃了一碗麻辣烫。').length === 0, '单句不该有边')


// 7) 跨消息：因为在前一条，所以在后一条 —— 单条抽不出，拼起来能抽
const cross = buildCausalFromParts(['手机没法 root，这条路走不通', '所以只能靠 Windows 常驻'])
ok(cross.length === 1 && cross[0].type === 'result', `跨消息应抽出 1 条 result，实际 ${JSON.stringify(cross)}`)
ok(cross[0].to > cross[0].from, `跨消息边应指向前后（实际 ${cross[0].from}→${cross[0].to}）`)

// 9) 小句粒度：同一个句号里"因为…所以…"也能连
const clause = buildCausal('因为手机没 root，所以只能靠电脑常驻', { granularity: 'clause' })
ok(clause.length >= 1, `句内小句应能抽出关系，实际 ${JSON.stringify(clause)}`)
const sentLevel = buildCausal('因为手机没 root，所以只能靠电脑常驻')
ok(sentLevel.length === 0, `句子粒度切不出（对照），实际 ${JSON.stringify(sentLevel)}`)

// 8) 单条时退化为普通抽取
ok(buildCausalFromParts(['我今天吃了一碗麻辣烫。']).length === 0, '单条无关系词时不该有边')
ok(buildCausalFromParts([]).length === 0, '空输入不该报错')
console.log(fail ? `FAIL ${fail}` : `PASS 因果边（因为/但是/所以 三类可抽，纯叙述与碎句不误报，上限 5）`)
process.exit(fail ? 1 : 0)
