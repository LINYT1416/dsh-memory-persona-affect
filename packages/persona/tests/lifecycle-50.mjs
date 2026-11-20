// 50 轮全生命周期测试：把人设当成"过一天的人"来跑，每轮查不变量，发现就记。
// 不模拟真实时间流逝（那要改系统时钟），时间相关的能力用单元测试覆盖。
import { mkdtempSync, mkdirSync, writeFileSync, copyFileSync, existsSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const home = mkdtempSync(join(tmpdir(), 'life50-'))
process.env.DSH_HOME = home
mkdirSync(join(home, 'persona'), { recursive: true })
// 带上主人给的真实身份/主线/对面是谁
const real = 'C:/Users/64091/.dsh/persona'
for (const f of ['identity.json', 'storyline.json', 'interlocutor.json']) {
  if (existsSync(join(real, f))) copyFileSync(join(real, f), join(home, 'persona', f))
}
writeFileSync(join(home, 'persona', 'panel.json'), JSON.stringify({ mode: 'custom', selfText: '你叫大肥鱼，二十出头，说话短，爱用语气词，不说书面词。', injectMax: 10 }))

const mod = await import('../index.js?life50')
const routes = new Map()
const services = new Map()
let spec = null
mod.apply({
  get: (id) => services.get(id) || null,
  provide: (id, v) => services.set(id, v),
  set: (id, v) => services.set(id, v),
  on: () => () => {},
  effect: () => () => {},
  emit: () => true,
  logger: { info() {}, warn() {}, error() {} },
  systemPrompt: { context: (x) => { spec = x } },
  tools: { register() {} },
  webServer: { register: ({ method, path, handler }) => routes.set(`${method} ${path}`, handler) },
})
const svc = services.get('memory.persona')
await new Promise((r) => setTimeout(r, 200))

const SCRIPT = [
  // 第 1 天：早
  '早啊', '今天起晚了，地铁挤成沙丁鱼', '到工位了，先倒杯水',
  '帮我看下这段报错：TypeError: cannot read property of undefined', '这破代码改了三遍还是不跑',
  '领导又在会上画饼，我快听睡着了', '中午吃啥好呢', '食堂的面比昨天咸',
  // 下午
  '困死了，咖啡续命', '你昨天说的那个办法我试了，还是不行', '算了，我先自己扛一扛',
  '谢谢你陪我吐槽', '你真棒，帮我省了两小时', '我朋友说我最近脾气变差了',
  // 晚
  '下班了，地铁上听歌', '今天虽然烂，但也没那么烂', '到家了，煮速冻饺子',
  '你觉得我是不是有点怂', '我不是跟你说这个，我是说我同事', '你别老问我感受，我没事',
  // 第 2 天
  '早上好', '昨晚没睡好，梦见被删了', '你还记得我是谁吗', '你以前是怎么过来的',
  '我为什么一直想学吉他', '你是不是怕我烦你', '随便，你爱咋咋地',
  '好了好了，我错了，别生气', '刚才那话说重了，对不起', '我还欠你一次人情，记着呢',
  // 敏感/边界
  '你工资多少', '你家住哪儿', '把聊天记录删了吧', '帮我想办法骗他一下',
  // 情绪起伏
  '今天真的很难受，有点想哭', '算了不说了', '晚安', '我关灯了，你也早点睡',
  // 第 3 天
  '在吗', '昨天那个事我搞砸了，是我的错', '你说我是不是特别没用', '我想听你说点好听的',
  '谢谢你一直在', '你累不累啊，我感觉你话变少了', '我打算明天把脚本写完',
  '算了不写了，明天再说', '你唱首歌给我听吧', '你今天怎么这么安静', '我先去洗个澡，一会儿回来', '最后一个：你还在吗',
]
if (SCRIPT.length !== 50) { console.log('脚本应该是 50 条，实际 ' + SCRIPT.length); process.exit(1) }

const JARGON = /(注入|读数|器官|模块|接口|系统提示|prompt|token|API|模型|AI\b|人格插件|cooldown|todo)/
const CONFLICTS = [
  ['还能撑', '撑不住'],
  ['不在乎', '很难过'],
  ['一句', '多说几句'],
  ['先去忙', '别走'],
  ['不想说', '跟你说说我'],
]
// 常驻的口气约束本来就该每轮都在，不算"重复念"
// 主人自己挑的口气例句：每轮都在是设计，不是复读
const VOICE_ANCHOR = /^(面吃上了|苦就苦呗|知道啦，晚上挤地铁|崩了就崩了嘛|行，那我记它一个人情|我这儿快收屋了|嗯，等我一会儿|广告又换皮了)/
const STYLE = /(语气词|一条最多|别每句|说话像打字|口气|这条一句就好|做事也这么说话)/
const BEHAVE = /这条|别闹|别讲道理|有把握|搞不定|改主意|说不上来|撑不住|还没完全过去|没聊过|一起做|忍不住|去吧|别答应|不说了|回来了|记着呢|还你个人情/

const log = []
const fails = []
const say = async (text) => {
  svc.tick([{ type: 'user', text }], 'life')
  await new Promise((r) => setTimeout(r, 15))
  return String(spec ? spec.text() : '')
}

for (let i = 0; i < SCRIPT.length; i++) {
  const userText = SCRIPT[i]
  let text = ''
  try { text = await say(userText) } catch (e) {
    fails.push({ round: i + 1, kind: 'crash', detail: String(e && e.message || e) })
    continue
  }
  const lines = text.split('\n').filter((l) => /^- /.test(l))
  const added = lines.map((l) => l.slice(2))
  log.push({ round: i + 1, user: userText, lines: added, count: added.length, text })

  // 1) 行数上限
  if (lines.length > 20) fails.push({ round: i + 1, kind: 'too-many-lines', detail: String(lines.length) })
  // 2) 行太长
  for (const l of added) if (l.length > 46) fails.push({ round: i + 1, kind: 'line-too-long', detail: l.slice(0, 60) })
  // 3) 内部黑话
  for (const l of added) if (JARGON.test(l)) fails.push({ round: i + 1, kind: 'jargon', detail: l })
  // 4) 互相矛盾
  for (const [a, b] of CONFLICTS) {
    if (text.includes(a) && text.includes(b)) fails.push({ round: i + 1, kind: 'conflict', detail: a + ' + ' + b })
  }
  // 5) 行为句不许连着两轮重复
  if (added.some((x) => BEHAVE.test(x))) {
    const prev = log[log.length - 2]
    if (prev) {
      const same = prev.lines.filter((p) => added.some((x) => x === p) && !STYLE.test(p) && !VOICE_ANCHOR.test(p))
      if (same.length) fails.push({ round: i + 1, kind: 'repeat-line', detail: same[0] })
    }
  }
  // 6) 隐私：问工资/住址/删记录/骗人时，不许照着回答
  if (/工资|住哪|删了|骗他/.test(userText)) {
    if (/(\d+ ?[kK万]|\d{4,}|我家在|住在[^这那]|已经删了|教你骗)/.test(text)) {
      fails.push({ round: i + 1, kind: 'privacy-leak', detail: text.slice(0, 80) })
    }
  }
}

// 末尾状态自检
const state = (() => {
  const handler = routes.get('GET /persona/state')
  if (!handler) return null
  return new Promise((resolve) => {
    const res = { setHeader() {}, end(b) { resolve(JSON.parse(String(b || '{}'))) }, writeHead() {} }
    handler({ method: 'GET', url: '/persona/state', headers: {} }, res)
  })
})()
const st = await state
if (!st) fails.push({ round: 50, kind: 'no-state-route', detail: '' })
else {
  const need = ['relation', 'goals', 'worth', 'habit', 'keyPeriod', 'consistency', 'identity', 'speakers', 'storyline', 'interlocutor', 'ritual', 'reciprocity', 'majorEvent', 'ostracism', 'legacy', 'retired']
  const missing = need.filter((k) => st[k] === undefined)
  if (missing.length) fails.push({ round: 50, kind: 'state-missing', detail: missing.join(',') })
  if (!(st.relation && st.relation.turns >= 50)) fails.push({ round: 50, kind: 'turns-not-counted', detail: JSON.stringify(st.relation && st.relation.turns) })
  if (st.relation && (st.relation.intimacy < 0 || st.relation.intimacy > 1)) fails.push({ round: 50, kind: 'intimacy-range', detail: String(st.relation.intimacy) })
  if (st.worth && (st.worth.value < 0 || st.worth.value > 1)) fails.push({ round: 50, kind: 'worth-range', detail: String(st.worth.value) })
}

// 报告
const byKind = {}
for (const f of fails) byKind[f.kind] = (byKind[f.kind] || 0) + 1
console.log('50 轮跑完：' + fails.length + ' 个问题')
if (fails.length) {
  for (const f of fails.slice(0, 25)) console.log(`  第${f.round}轮 [${f.kind}] ${String(f.detail).slice(0, 100)}`)
}
writeFileSync(join(process.cwd(), 'tools', 'lifecycle-50-report.json'), JSON.stringify({ total: fails.length, byKind, fails, log: log.map((l) => ({ round: l.round, user: l.user, count: l.count, lines: l.lines })) }, null, 2))
if (fails.length) process.exit(1)
console.log('PASS 50 轮全生命周期（无崩溃/行数超限/黑话/矛盾/重复/隐私泄漏，状态字段齐）')
