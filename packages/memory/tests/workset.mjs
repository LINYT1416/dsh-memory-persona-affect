// 工作集压缩（前额叶）：给记忆器官用的压缩，不是通用摘要。
// 判据：预算、可复现、去重、指针能回到细节、挤到极限也不丢"现在在做"。
//   node tests/workset.mjs
import { buildWorkingSet, estimateTokens } from '../organs/prefrontal/workset.js'

const fails = []
const ok = (c, m) => { if (!c) fails.push(m) }

// 200 轮：第 3 轮埋一个必须能被"回取"的细节
const turns = []
for (let i = 0; i < 200; i += 1) {
  if (i === 2) {
    turns.push({ role: 'user', text: '我下周三要去面结构设计岗，记得带上 SolidWorks 图纸和成绩单。', episodeId: 'ep_3', at: 1000 + i })
  } else if (i === 120) {
    turns.push({ role: 'user', text: '那就用 bge-small 做向量，别换模型了。', episodeId: 'ep_120', at: 1000 + i })
  } else {
    turns.push({ role: i % 2 ? 'assistant' : 'user', text: `第${i}句：改了第${i}个参数，跑了一遍测试，都过了。`, episodeId: `ep_${i}`, at: 1000 + i })
  }
}

const wide = buildWorkingSet(turns, { budgetTokens: 600 })
ok(wide.tokens <= 600, `超预算：${wide.tokens}/600`)
ok(wide.text.includes('工作记忆'), '没有压缩块标题')
ok(wide.kept.pointers.some((p) => p.id === 'ep_3'), `第 3 轮的细节没进指针：${JSON.stringify(wide.kept.pointers.slice(0, 3))}`)
ok(wide.kept.pointers.find((p) => p.id === 'ep_3')?.hint.includes('结构设计'), '指针线索没指到那件事')
ok(wide.kept.facts.some((s) => s.includes('bge-small')), `决定没进结论：${JSON.stringify(wide.kept.facts)}`)
ok(wide.kept.todo.some((s) => s.includes('图纸')), `"记得带图纸"没进未完成：${JSON.stringify(wide.kept.todo)}`)

// 同一份输入跑两次必须一模一样（可复现）
const again = buildWorkingSet(turns, { budgetTokens: 600 })
ok(JSON.stringify(again.raw) === JSON.stringify(wide.raw), '同一输入两次结果不同（不可复现）')

// 去重：同一句重复很多遍只留一次
const dup = buildWorkingSet([
  { text: '还没跑测试，等会儿跑。', episodeId: 'a' },
  { text: '还没跑测试，等会儿跑。', episodeId: 'b' },
  { text: '还没跑测试，等会儿跑。', episodeId: 'c' },
], { budgetTokens: 400 })
ok(dup.kept.todo.filter((s) => s.includes('等会儿跑')).length === 1, `重复句没去重：${JSON.stringify(dup.kept.todo)}`)

// 极限预算：只剩小块也要保住"现在在做"，并且不超预算
const tight = buildWorkingSet(turns, { budgetTokens: 220 })
ok(tight.tokens <= 220, `极限预算超了：${tight.tokens}/220`)
ok(tight.text.length > 0, '极限预算把内容全丢了')

// 空输入不许编
const empty = buildWorkingSet([], { budgetTokens: 400 })
ok(empty.text === '', '空输入却生成了内容')

// token 估价单调：更长不更小
ok(estimateTokens('一二三四五六') > estimateTokens('一二三'), 'token 估价不单调')

if (fails.length) {
  console.log(`FAIL ${fails.length}:`)
  for (const f of fails) console.log(' - ' + f)
  process.exit(1)
}
console.log(`PASS 工作集压缩（600 预算用 ${wide.tokens}；220 极限用 ${tight.tokens}；指针 ${wide.kept.pointers.length} 条，第 3 轮细节可回取；重复句已去）`)
process.exit(0)
