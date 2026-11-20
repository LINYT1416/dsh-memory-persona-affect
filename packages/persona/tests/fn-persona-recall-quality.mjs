import { pickRecall } from '../core/remember.js'
const now = 2_000_000_000_000
const DAY = 86400000
const eps = [
  { brief: '我说：好', at: now - 5 * DAY },
  { brief: '我说：嗯', at: now - 5 * DAY },
  { brief: '我说：今天在公司楼下买了橘子，老板让尝了一瓣', at: now - 4 * DAY },
  { brief: '我说：面吃上了，有点咸但真香', at: now - 3 * DAY },
]
const got = pickRecall(eps, { now, max: 3 })
const fails = []
const texts = got.map((g) => g.text)
if (texts.includes('我说：好') || texts.includes('我说：嗯')) fails.push('纯应答不该被挑：' + JSON.stringify(texts))
if (!texts.some((t) => t.includes('橘子'))) fails.push('具体的事应该排第一：' + JSON.stringify(texts))
if (got[0] && !got[0].text.includes('橘子')) fails.push('排序不对，第一个是：' + got[0].text)
if (fails.length) { fails.forEach((f) => console.log('FAIL ' + f)); process.exit(1) }
console.log('PASS 主动提起挑事（' + got.map((g) => g.text.replace(/^我说[：:]/, '')).join('｜') + '；纯应答被挡）')
