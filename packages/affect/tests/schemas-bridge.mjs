// 图式接线：bridge.schemas 必须能从皮层概念里取出「谓词：对象」，
// 即使概念对象里没有 confidence 字段（真实数据就常常没有）。
import { createBridge } from '../core/bridge.js'

const fails = []
const ok = (c, m) => { if (!c) fails.push(m) }

const conceptSamples = [
  { predicate: '计划', object: '搞一个 QQ 机器人 24 小时在线' },
  { predicate: '地点', object: '楼下', score: 0.9 },
  { predicate: '讨厌', object: '鲸鱼贴纸那种风格', confidence: 0.92 },
  { predicate: '计划', object: '明天早上七点二十起床' },
]
const cortex = {
  concepts: (q, k) => ({ items: conceptSamples.slice(0, k) }),
}

const bridge = createBridge((id) => (id === 'memory.cortex' ? cortex : null))
const out = bridge.schemas('明天干点什么', 3)

ok(Array.isArray(out), `schemas 应当返回数组，实际 ${typeof out}`)
ok(out.length === 3, `应当取 3 条，实际 ${JSON.stringify(out)}`)
ok(out.every((s) => s.includes('：')), `每条都应当是"谓词：对象"形式，实际 ${JSON.stringify(out)}`)
ok(out[0] === '计划：搞一个 QQ 机器人 24 小时在线', `第一条不对：${out[0]}`)

// 没皮层时不许崩，返回 null
const empty = createBridge(() => null)
ok(empty.schemas('随便', 3) === null, '没有皮层时应当返回 null 而不是抛错')

if (fails.length) {
  console.log(`FAIL ${fails.length}:`)
  for (const f of fails) console.log(' - ' + f)
  process.exit(1)
}
console.log(`PASS 图式可从皮层概念生成：${out.join(' / ')}`)
process.exit(0)
