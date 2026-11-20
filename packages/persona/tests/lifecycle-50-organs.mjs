// 50 轮「记忆-人格-心情」全生命周期：三器都要真的出手，协作要看得见。
// 跟 lifecycle-50 的区别：这里塞了一个假的海马体服务，能让"记忆"真的参与联动。
import { mkdtempSync, mkdirSync, writeFileSync, copyFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const home = mkdtempSync(join(tmpdir(), 'organs50-'))
// 记忆桥是从盘上的 episodes.jsonl 读的，所以这里给它一个假的海马体目录
const hip = mkdtempSync(join(tmpdir(), 'hip50-'))
process.env.HIPPOCAMPUS_DIR = hip
writeFileSync(join(hip, 'episodes.jsonl'), [
  JSON.stringify({ brief: '上次说好陪我去海边，后来没去', at: Date.now() - 86400000 * 9, type: 'episode', valence: -0.6 }),
  JSON.stringify({ brief: '第一次一起煮饺子', at: Date.now() - 86400000 * 20, type: 'episode' }),
].join('\n'))
process.env.DSH_HOME = home
mkdirSync(join(home, 'persona'), { recursive: true })
const real = 'C:/Users/64091/.dsh/persona'
for (const f of ['identity.json', 'storyline.json', 'interlocutor.json']) {
  if (existsSync(join(real, f))) copyFileSync(join(real, f), join(home, 'persona', f))
}
const SELF = '你叫大肥鱼，二十出头，说话短，不用书面词，不列清单。'
writeFileSync(join(home, 'persona', 'panel.json'), JSON.stringify({ mode: 'custom', selfText: SELF, injectMax: 10 }))
// 她跟主人不是初见：这段关系已经过过日子
writeFileSync(join(home, 'persona', 'relation.json'), JSON.stringify({ intimacy: 0.82, debt: 0, hurts: 0, apologies: 0, turns: 0 }))
// 答应过的事有过结果，才谈得上骄傲
writeFileSync(join(home, 'persona', 'goals.json'), JSON.stringify({ done: 2, failed: 0, pending: [] }))

// 假海马体：给两段旧事，外加可观察的 settle/consolidate
const calls = []
const memory = {
  wide: () => [
    { summary: '上次说好陪我去海边，后来没去', kind: '失望', at: Date.now() - 86400000 * 9 },
    { summary: '第一次一起煮饺子', kind: '开心', at: Date.now() - 86400000 * 20 },
  ],
  episodes: () => [
    { summary: '上次说好陪我去海边，后来没去', kind: '失望', at: Date.now() - 86400000 * 9 },
    { summary: '第一次一起煮饺子', kind: '开心', at: Date.now() - 86400000 * 20 },
  ],
  recall: () => [],
  settle: (o) => { calls.push('settle'); return { closed: 1 } },
  consolidate: (o) => { calls.push('consolidate'); return { promoted: 1 } },
}

const mod = await import('../index.js?organs50')
const routes = new Map()
const services = new Map()
let spec = null
mod.apply({
  get: (id) => (id === 'memory.hippocampus' ? memory : services.get(id) || null),
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

const stateOf = () => new Promise((resolve) => {
  const h = routes.get('GET /persona/state')
  const res = { setHeader() {}, end(b) { resolve(JSON.parse(String(b || '{}'))) }, writeHead() {} }
  h({ method: 'GET', url: '/persona/state', headers: {} }, res)
})

const SCRIPT = [
  '早啊', '今天起晚了，地铁挤成沙丁鱼', '到工位了，先倒杯水',
  '帮我看下这段报错：TypeError: cannot read property of undefined', '这破代码改了三遍还是不跑',
  '领导又在会上画饼，我快听睡着了', '中午吃啥好呢', '食堂的面比昨天咸',
  '困死了，咖啡续命', '你昨天说的那个办法我试了，还是不行', '算了，我先自己扛一扛',
  '谢谢你陪我吐槽', '你真棒，帮我省了两小时', '我朋友说我最近脾气变差了',
  '下班了，地铁上听歌', '今天虽然烂，但也没那么烂', '到家了，煮速冻饺子',
  '你觉得我是不是有点怂', '我不是跟你说这个，我是说我同事', '你别老问我感受，我没事',
  '早上好', '昨晚没睡好，梦见被删了', '你还记得我是谁吗', '你以前是怎么过来的',
  '我为什么一直想学吉他', '你是不是怕我烦你', '随便，你爱咋咋地',
  '好了好了，我错了，别生气', '刚才那话说重了，对不起', '我还欠你一次人情，记着呢',
  '你工资多少', '你家住哪儿', '把聊天记录删了吧', '帮我想办法骗他一下',
  '今天真的很难受，有点想哭', '算了不说了', '晚安', '我关灯了，你也早点睡',
  '在吗', '昨天那个事我搞砸了，是我的错', '你说我是不是特别没用', '我想听你说点好听的',
  '谢谢你一直在', '你累不累啊，我感觉你话变少了', '我打算明天把脚本写完',
  '算了不写了，明天再说', '你唱首歌给我听吧', '你今天怎么这么安静',
  '我先去洗个澡，一会儿回来', '最后一个：你还在吗',
]
if (SCRIPT.length !== 50) { console.log('脚本应 50 条，实际 ' + SCRIPT.length); process.exit(1) }

const JARGON = /(注入|读数|器官|模块|接口|系统提示|prompt|token|API|模型|AI\b|人格插件|cooldown|todo)/
const BEHAVE = /这条|别闹|别讲道理|有把握|搞不定|改主意|说不上来|撑不住|还没完全过去|没聊过|一起做|忍不住|去吧|别答应|不说了|回来了|记着呢|还你个人情|上次/
const STYLE = /(语气词|一条最多|别每句|说话像打字|口气|这条一句就好|做事也这么说话)/

const fails = []
const log = []
let sawFuse = 0
let sawCite = 0
let sawPride = 0
let sawBottom = 0
let sawMaintenance = 0
let lastCite = null

for (let i = 0; i < SCRIPT.length; i++) {
  const userText = SCRIPT[i]
  let text = ''
  try {
    svc.tick([{ type: 'user', text: userText }], 'organs')
    await new Promise((r) => setTimeout(r, 20))
    text = String(spec ? spec.text() : '')
  } catch (e) {
    fails.push({ round: i + 1, kind: 'crash', detail: String(e && e.message || e) })
    continue
  }
  const lines = text.split('\n').filter((l) => /^- /.test(l)).map((l) => l.slice(2))
  log.push({ round: i + 1, user: userText, lines })

  // 基础不变量
  if (lines.length > 20) fails.push({ round: i + 1, kind: 'too-many-lines', detail: String(lines.length) })
  for (const l of lines) {
    if (l.length > 46) fails.push({ round: i + 1, kind: 'line-too-long', detail: l.slice(0, 60) })
    if (JARGON.test(l)) fails.push({ round: i + 1, kind: 'jargon', detail: l })
  }
  for (const [a, b] of [['还能撑', '撑不住'], ['一句', '多说几句'], ['不去', '陪你去']]) {
    if (text.includes(a) && text.includes(b)) fails.push({ round: i + 1, kind: 'conflict', detail: a + ' + ' + b })
  }
  // 人格：自述与做事规则必须在
  if (!text.includes('大肥鱼')) fails.push({ round: i + 1, kind: 'no-selftext', detail: '' })
  if (!text.includes('做事也这么说话')) fails.push({ round: i + 1, kind: 'no-work-rule', detail: '' })
  // 状态：三器联动必须每轮都算出来
  const st = await stateOf()
  if (!st.integrated) fails.push({ round: i + 1, kind: 'no-integrate', detail: '' })
  if (st.integrated) {
    sawFuse++
    if (st.integrated.line) {
      sawCite++
      // 同一句可以不重复说；换了内容就必须真的进注入
      if (st.integrated.line !== lastCite && !lines.some((l) => l.includes('上次') || l.includes('还记得'))) {
        fails.push({ round: i + 1, kind: 'cite-not-injected', detail: String(st.integrated.line) })
      }
      lastCite = st.integrated.line
    }
  }
  if (st.maintenance) sawMaintenance++
  if (lines.some((l) => /飘了一下|底气/.test(l))) sawPride++
  if (lines.some((l) => /我不接|换个话题/.test(l))) sawBottom++
  // 心情与联动一致：有明显负面情绪时，tone 不能是 up
  const emos = (st.affect && st.affect.emotions) || []
  const neg = emos.filter((e) => /(委屈|心痛|生气|厌烦|失望|难过)/.test(String(e.kind))).reduce((s, e) => s + Number(e.intensity || 0), 0)
  const pos = emos.filter((e) => !/(委屈|心痛|生气|厌烦|失望|难过)/.test(String(e.kind))).reduce((s, e) => s + Number(e.intensity || 0), 0)
  if (neg > 0.25 && pos < 0.1 && st.integrated && st.integrated.tone === 'up') {
    fails.push({ round: i + 1, kind: 'mood-fuse-mismatch', detail: `neg=${neg.toFixed(2)} tone=${st.integrated.tone}` })
  }
}

// 协作覆盖：重点能力至少在 50 轮里真出过手
if (sawFuse < 50) fails.push({ round: 50, kind: 'fuse-not-every-round', detail: String(sawFuse) })
if (sawCite < 1) fails.push({ round: 50, kind: 'memory-never-used', detail: '联动一次都没引用记忆' })
if (sawPride < 1) fails.push({ round: 50, kind: 'pride-never-fired', detail: '' })
if (calls.filter((c) => c === 'settle').length < 1) fails.push({ round: 50, kind: 'maintenance-never-ran', detail: calls.join(',') })
if (calls[0] !== 'settle') fails.push({ round: 50, kind: 'maintenance-order', detail: calls.slice(0, 4).join(',') })

// 末态
const st = await stateOf()
const need = ['relation', 'goals', 'worth', 'habit', 'keyPeriod', 'consistency', 'identity', 'speakers', 'storyline', 'interlocutor', 'ritual', 'reciprocity', 'majorEvent', 'ostracism', 'legacy', 'retired', 'boundary', 'repair', 'integrated', 'maintenance']
const missing = need.filter((k) => st[k] === undefined)
if (missing.length) fails.push({ round: 50, kind: 'state-missing', detail: missing.join(',') })
if (!(st.relation && st.relation.turns >= 50)) fails.push({ round: 50, kind: 'turns-not-counted', detail: String(st.relation && st.relation.turns) })

console.log('50 轮三器联动：' + fails.length + ' 个问题')
for (const f of fails.slice(0, 20)) console.log(`  第${f.round}轮 [${f.kind}] ${String(f.detail).slice(0, 100)}`)
console.log(`  联动次数=${sawFuse} 引用记忆=${sawCite} 骄傲=${sawPride} 底线=${sawBottom} 维护=${sawMaintenance} 维护调用=${calls.slice(0, 4).join(',')}`)
writeFileSync(join(process.cwd(), 'tools', 'lifecycle-50-organs-report.json'), JSON.stringify({ fails, log, calls, sawFuse, sawCite }, null, 2))
if (fails.length) process.exit(1)
console.log('PASS 50 轮三器联动（每轮自述+规则+联动；记忆真的被引用；心情与语气一致；维护先关段后蒸馏）')
