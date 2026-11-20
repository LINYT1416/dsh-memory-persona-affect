// surface 拉取：形状取自磁盘上的真实投影（node.val.turns[{turn,seq,prompt,response}]），
// 不是猜的。用真实样本做一次解析，防止再靠"看着像"就上线。
import { collectTurns, pullNew, pullAgents } from '../organs/hippocampus/lib/agent-pull.js'

let fail = 0
const ok = (c, m) => { if (!c) { fail++; console.log('FAIL', m) } else { console.log('  ok:', m) } }

const node = (turns) => ({ val: { turns, draft: null } })

const real = node([
  { turn: 1, seq: 10, prompt: '我就要求你一件事，先对这3个插件挨个进行功能对照', response: '第一轮改完了，三个插件各修一处结构性断裂' },
  { turn: 2, seq: 288, prompt: '重启完了，赶紧的！', response: '拉取已经真的在往记忆里写了' },
])

// 1) 两轮 → 四个消息
const all = collectTurns([real])
ok(all.length === 4, `应取到 4 条，实际 ${all.length}`)
ok(all[0].role === 'user' && all[0].text.startsWith('我就要求你'), '第一条应是你说的话')
ok(all[1].role === 'assistant', '第二条应是我说的话')

// 2) 增量：游标停在第一轮回复之后，只剩第二轮
const inc = pullNew([real], 10.5)
ok(inc.items.length === 2, `应只剩第二轮 2 条，实际 ${inc.items.length}`)
ok(inc.next === 288.5, `下一个游标应是 288.5，实际 ${inc.next}`)

// 3) 追平后不再重复
ok(pullNew([real], inc.next).items.length === 0, '追平后应为空')

// 4) 空/异常节点不炸
ok(collectTurns([{}, null, { val: {} }, { val: { turns: [] } }]).length === 0, '空节点应返回空')
ok(pullNew([], 0).items.length === 0, '空 surface 应为空')

// 5) 多会话各用各的游标；首见只对齐、不补历史
const cursors = new Map()
const got = []
const agents = [
  { id: 'A', session: { surface: { nodes: [real] } } },
  { id: 'B', session: { surface: { nodes: [node([{ turn: 1, seq: 5, prompt: 'B 的话', response: 'B 的回复' }])] } } },
]
await pullAgents(agents, cursors, async (it) => got.push(it))
ok(got.length === 0, `首见不该灌历史，实际写了 ${got.length} 条`)
ok(cursors.get('A') === 288.5 && cursors.get('B') === 5.5, '首见后游标应对齐到最新')

// 再拉一次：没有新内容，仍然为空
got.length = 0
await pullAgents(agents, cursors, async (it) => got.push(it))
ok(got.length === 0, '没有新轮次时不该写')

// 有新轮次时：只写新的那两条
agents[0].session.surface.nodes = [node([
  { turn: 1, seq: 10, prompt: '旧的', response: '旧的回复' },
  { turn: 2, seq: 288, prompt: '旧的第二轮', response: '旧的回复二' },
  { turn: 3, seq: 400, prompt: '新的问题', response: '新的回答' },
])]
got.length = 0
await pullAgents(agents, cursors, async (it) => got.push(it))
ok(got.length === 2, `新增一轮应只写 2 条，实际 ${got.length}`)
ok(got[0].text === '新的问题' && got[1].text === '新的回答', '内容应是新那一轮')
ok(got[0].sessionId === 'A', '应带上会话 id')

// 6) 只有 prompt、还没回复的轮次也要能取
ok(collectTurns([node([{ turn: 3, seq: 300, prompt: '只说了半句' }])]).length === 1, '半轮应取到 1 条')

console.log(fail ? `FAIL ${fail}` : 'PASS surface 拉取（真实形状/增量/追平/空/多会话/半轮）')
process.exit(fail ? 1 : 0)
