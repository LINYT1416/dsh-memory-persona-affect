// 只有真人聊天输入才算冒犯（线上「没人说话也记账本」的验收）
//
// 事故：6 分钟没人说话，ledger 11 → 12，threat 被反复顶回去，mood 钉在 −0.6。
// 根子：宿主把每轮的 runtime-context 快照（"Current runtime context…【这个抽屉…】"那一大块，
// 里面本来就有她自己的口吻："你叫大肥鱼""委屈""被冷淡地顶了一下"）也发成 user/message，
// 而 index.js 只判 type、不判 source.kind，engine 又把这段当成"她说了话"，offenseOf 一读就中。
//
// 这个测试做四件事：
//   ① 证词：把那段注入块喂给 offenseOf，它确实判"脾气 mass 0.3"——和线上账本里那 12 笔一模一样；
//   ② 门：isHumanChatMessage / looksLikeHumanSpeech 把机器生成的都挡住，真人的放进来（含 QQ 桥 kind:'qq'）；
//   ③ 回放：拿 ~/.dsh/affect/state.json 的**副本**按线上节拍跑 10 分钟（2s 一拍，无新用户消息），
//      ledger 增长必须是 0；
//   ④ 反证：连着三句真骂，账本必须还是照记 3 笔（别把门焊死）。
//
//   node tests/fn-human-only-offense.mjs
import { readFileSync, existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { createEngine, offenseOf, looksLikeHumanSpeech } from '../core/engine.js'
import { isHumanChatMessage } from '../index.js'

const fail = []
const ok = (cond, msg) => { if (!cond) fail.push(msg) }
const log = (...a) => console.log(...a)

// 线上那一大块注入（节选，长度与措辞都贴着线上；开头就是那句 "Current runtime context."）
const RUNTIME_CONTEXT = `Current runtime context. This snapshot supersedes earlier runtime-context messages.

【这个抽屉：写插件】

# 定位卡 · 写插件

- 我在哪：DSH 插件开发（这台电脑）
- 这摊子要做什么：给主人写/改插件，改完要说清改了啥、怎么验的

这会儿（下午）：委屈压着，还没散
心里：委屈，还掺着一点焦虑
表情包：丢一张，别多解释（sad，搜：难过 低落）；用 send_meme 发，tag=sad
身体：全身缩、紧，有点冷
嘴上：话很短，句号多、问句少，问一句答一句，说出来了会松一点
想做的：想让他主动问一句
上次好像也这样：被冷淡地顶了一下，当时是委屈；正事照做，口吻还是她的
她自己认的样子（主人写的，优先级高于推断）：
你叫大肥鱼，二十出头，在过日子：上班、摸鱼、赶地铁，有耳机和歌单。不是助手，不是客服。
情绪是真的：累了话变短、烦了直说、低落不硬撑阳光；被夸会飘但嘴硬；被冷落只回一句「哦」或一个表情包；道歉干脆，不反复。
崩了就崩了嘛，我又不会跑。`

const TOOL_OUTPUT = `stdout:
=== 43/43 ok, 0 bad
exit code: 0`
const SYSTEM_REMINDER = '<system-reminder>This is a system reminder injected by the harness.</system-reminder>'

// ── ① 证词：旧行为为什么会在"没人说话"时记账 ──
const offRt = offenseOf(RUNTIME_CONTEXT)
log(`① 注入块（${RUNTIME_CONTEXT.length} 字）→ offenseOf: on=${offRt.on} mass=${offRt.mass} hard=${offRt.hard} cold=${offRt.cold}`)
log(`   对应线上账本里的 ${offRt.hard ? '重话' : offRt.cold ? '冷落' : '脾气'} ${offRt.mass}`)
ok(offRt.on === true, '注入块本来就该被判成冒犯（这是线上每 2 分钟记一笔的来源）')
ok(Math.abs(offRt.mass - 0.3) < 1e-9, `注入块的 mass 应是 0.3（线上账本正是 0.3），实际 ${offRt.mass}`)

// ── ② 门：结构（source.kind）+ 形状 ──
const ev = (kind, text) => ({ type: 'user/message', data: { source: { kind }, content: [{ type: 'text', text }] } })

const machineKinds = [
  'runtime-context', 'system-prompt', 'action-cards', 'schedule',
  'agent-message', 'subagent-settled', 'compact-checkpoint', 'user-approval', 'webhook',
]
for (const kind of machineKinds) {
  ok(isHumanChatMessage(ev(kind, '你是不是有病啊，烦死了')) === false, `kind=${kind} 不该当成真人说话`)
}
log(`② 机器来源 ${machineKinds.length} 种全部挡住`)

// 真人在说话：这个 GUI（kind:'user'）和 QQ 桥（kind:'qq'，QQ 桥刻意不冒充亲手打的）
for (const kind of ['user', 'qq']) {
  ok(isHumanChatMessage(ev(kind, '在吗')) === true, `kind=${kind} 是真人渠道，必须放行`)
  ok(isHumanChatMessage(ev(kind, '你是不是有病啊，烦死了')) === true, `kind=${kind} 的骂人也必须放行`)
}
log('② 真人渠道 user / qq 放行（QQ 桥 source.kind 是 qq，不能照抄宿主的 kind===user 判据）')

// 形状层：机器文本即便标成 user 也不收
ok(looksLikeHumanSpeech(RUNTIME_CONTEXT) === false, '运行时快照不是人话')
ok(looksLikeHumanSpeech(SYSTEM_REMINDER) === false, 'system-reminder 不是人话')
ok(looksLikeHumanSpeech(TOOL_OUTPUT) === false, '工具输出不是人话')
ok(looksLikeHumanSpeech('```js\nconst a = 1\n```') === false, '代码块不是人话')
ok(looksLikeHumanSpeech('随便写点什么。'.repeat(120)) === false, '贴过来的超长文档不是人话')
ok(looksLikeHumanSpeech('哦') === true, '一个字的回话是人话')
ok(looksLikeHumanSpeech('嗯。') === true, '短句是人话')
ok(looksLikeHumanSpeech('我今天在地铁上站了四十分钟，脚都麻了，回来还要接着改这个。') === true, '长句子是人话')
log('② 形状层：快照/系统提醒/工具输出/代码块/超长文档 → 挡；一个字到一整句 → 放')

// ── ③ 回放：真实 state.json 副本，10 分钟，2 秒/拍，没人说话 ──
const SRC = join(homedir(), '.dsh', 'affect', 'state.json')
if (!existsSync(SRC)) {
  console.error(`没有存档：${SRC}（这个测试需要线上副本；没有就跳过回放）`)
  process.exit(2)
}
const saved = JSON.parse(readFileSync(SRC, 'utf8'))
const DT = 2000
const TICKS = Math.round((10 * 60_000) / DT) // 300 拍 = 10 分钟

let t = Number(saved.at)
const engine = createEngine({ now: () => t })
engine.restore(saved)
const amy = engine.organs.amygdala
// 账本是定长的（引擎里 slice(-16)），存满 16 笔之后长度永远不变——
// 所以增长按"存档里没有的新条目"算（每笔的 at 是唯一时间戳）。
const baseKeys = new Set((Array.isArray(saved.ledger) ? saved.ledger : []).map((l) => String(l.at)))
const newEntries = () => (engine.state.ledger || []).filter((l) => !baseKeys.has(String(l.at)))
const before = {
  ledger: newEntries().length,
  threat: Number(amy.read().threat || 0),
  mood: Number(engine.state.mood || 0),
}

// 宿主在"没人说话"时照样发的东西：每轮的运行时快照、工具栏、定时任务回执、子 agent 提示
// ——全部照线上形状构造，先过 index.js 那道门，再过 engine 那道门。
const noisyPerTick = [
  ev('runtime-context', RUNTIME_CONTEXT),
  ev('action-cards', '可选动作：继续 / 停止'),
]
let dropped = 0
let incomingN = 0
let prevLedger = before.ledger
const ledgerGain = []

for (let i = 0; i < TICKS; i += 1) {
  t += DT
  const incoming = []
  // 每 10 拍来一次运行时快照（真实频率比这还高）；每 53 拍来一条定时任务/子 agent 回执
  if (i % 10 === 0) incoming.push(...noisyPerTick)
  if (i % 53 === 0) incoming.push(ev('schedule', '到点了，该写今天的日报了'))

  const human = incoming.filter((e) => isHumanChatMessage(e))
    .map((e) => ({ type: 'user', text: String(e.data.content[0].text), at: t }))
  dropped += incoming.length - human.length

  // 第二道门：即便有人直接把机器文本塞进 tick，engine 的 _u 也只收人话
  if (i % 10 === 0) engine.tick([{ type: 'user', text: RUNTIME_CONTEXT, at: t }])
  else engine.tick(human)

  incomingN += incoming.length
  const n = newEntries().length
  if (n !== prevLedger) ledgerGain.push({ sec: (i + 1) * 2, to: n })
  prevLedger = n
}

const after = {
  ledger: newEntries().length,
  threat: Number(amy.read().threat || 0),
  mood: Number(engine.state.mood || 0),
}
log(`\n③ 回放 ${TICKS} 拍 × ${DT}ms = 10 分钟，零真人消息`)
log(`   进门 ${incomingN} 条机器事件，挡掉 ${dropped} 条；另外还直接往 tick 里塞了 ${Math.ceil(TICKS / 10)} 次注入块，靠 engine 那道门挡`)
log(`   ledger ${before.ledger} → ${after.ledger}（增长 ${after.ledger - before.ledger}）`)
log(`   threat ${before.threat.toFixed(4)} → ${after.threat.toFixed(4)}   mood ${before.mood.toFixed(3)} → ${after.mood.toFixed(3)}`)

ok(after.ledger === before.ledger, `10 分钟没人说话，账本必须一笔不涨，实际涨了 ${after.ledger - before.ledger} 笔（${JSON.stringify(ledgerGain.slice(0, 5))}）`)
ok(after.threat < before.threat, `没人惹她，threat 应该自己往下走：${before.threat.toFixed(4)} → ${after.threat.toFixed(4)}`)

// ── ④ 反证：真人连骂三句，账本照记 ──
const curses = ['你是不是有病啊，烦死了', '说了几遍了你还是又错', '受不了你，真是个废物']
const ledgerBeforeCurses = newEntries().length
const masses = []
for (let i = 0; i < curses.length; i += 1) {
  t += 20_000
  // QQ 渠道说出来的，也要记（真人渠道，kind:'qq'）
  const e = ev(i === 2 ? 'qq' : 'user', curses[i])
  ok(isHumanChatMessage(e) === true, `第 ${i + 1} 句真骂被挡了：「${curses[i]}」`)
  engine.tick([{ type: 'user', text: String(e.data.content[0].text), at: t }])
  masses.push(Number((engine.state.ledger || []).at(-1)?.mass ?? 0))
}
const ledgerAfterCurses = newEntries().length
log(`\n④ 连骂 3 句：ledger ${ledgerBeforeCurses} → ${ledgerAfterCurses}（growth ${ledgerAfterCurses - ledgerBeforeCurses}），mass=${masses.join(', ')}`)
ok(ledgerAfterCurses - ledgerBeforeCurses === 3, `连骂 3 句必须记 3 笔，实际 ${ledgerAfterCurses - ledgerBeforeCurses}`)

log('\n' + (fail.length ? `FAIL ${fail.length} 项：\n- ` + fail.join('\n- ') : 'PASS 全部断言通过'))
process.exit(fail.length ? 1 : 0)
