// 各司其职：不看"有没有数"，只看"输入变了它有没有按该有的方向动"。
//   node tests/behavior.mjs
import { createEngine } from '../core/engine.js'
import { createBridge } from '../core/bridge.js'
import { render } from '../core/inject.js'

const fails = []
const ok = (c, m) => { if (!c) fails.push(m) }
const near = (a, b, tol, m) => ok(Math.abs(a - b) <= tol, `${m}（期望≈${b}，实际 ${a}）`)

const mk = (t0 = new Date('2026-11-12T09:00:00+08:00').getTime()) => {
  let t = t0
  const e = createEngine({ now: () => t })
  return { e, at: () => t, go: (min = 60) => { t += min * 60_000 }, say: (text) => { e.tick([{ type: 'user', text, at: t }]) } }
}

// 1. 下丘脑：饿会随小时涨
{
  const { e, go } = mk()
  const h0 = e.organs.hypothalamus.snapshot().hunger
  for (let i = 0; i < 5; i++) { go(60); e.tick([]) }
  const h1 = e.organs.hypothalamus.snapshot().hunger
  ok(h1 > h0, `饿了五个小时饥饿度该涨（${h0.toFixed(2)} → ${h1.toFixed(2)}）`)
}

// 2. 杏仁核：被骂 threat 要涨；被夸 reward 要涨
{
  const a = mk()
  a.say('你行不行啊，这都做不好，又崩了')
  const threatBad = a.e.organs.amygdala.read().threat
  const b = mk()
  b.say('做得好，这次很稳，谢谢你')
  const threatGood = b.e.organs.amygdala.read().threat
  ok(threatBad > threatGood, `被骂的威胁该高于被夸（${threatBad.toFixed(2)} vs ${threatGood.toFixed(2)}）`)
  ok(b.e.organs.amygdala.read().rewardPE > 0, '被夸要有正性预测误差')
}

// 3. 岛叶：难受的话身体感更强
{
  const a = mk(); a.say('烦死了，胸口堵得慌，一点都不想说话')
  const b = mk(); b.say('今天周三')
  ok(a.e.organs.insula.read().felt.intensity > b.e.organs.insula.read().felt.intensity, '难受时体感强度该更高')
}

// 4. 前额叶：被盯着骂时抑制更用力（mask 上升）
{
  const a = mk(); a.say('你怎么又错了，大家都看着呢')
  const b = mk(); b.say('这个参数是多少')
  ok(a.e.organs.pfc.read().display.mask > b.e.organs.pfc.read().display.mask, '被当众说时该更用力压住表情')
}

// 5. 社交：被冷落会疼
{
  const a = mk(); a.say('算了，不说了'); a.go(5); a.e.tick([]); a.say('随便吧'); a.go(5); a.e.tick([]); a.say('哦')
  const b = mk(); b.say('那我们一起看看这个')
  ok(a.e.organs.social.read().socialPain >= b.e.organs.social.read().socialPain, '被冷落后社交痛不该更低')
}

// 6. 后扣带：有记忆就有锚点，负性旧事启动反刍
{
  const hip = { recallSync: () => ({ ok: true, hits: [{ id: 'e1', brief: '上次插件跑通了又崩了', valence: -0.6 }] }), write: () => null }
  const br = createBridge((id) => (id === 'memory.hippocampus' ? hip : null))
  let t = new Date('2026-11-12T10:00:00+08:00').getTime()
  const e = createEngine({ now: () => t, bridge: br })
  e.tick([{ type: 'user', text: '插件又崩了', at: t }])
  const d = e.organs.dmn.snapshot()
  ok(d.anchors > 0, `后扣带该拿到锚点，实际 ${d.anchors}`)
  ok(d.rumination > 0, `负性旧事该启动反刍，实际 ${d.rumination}`)
}

// 7. 情绪构造：强负性必须出负性情绪，且不许出正面
{
  const { e } = mk()
  e.tick([{ type: 'user', text: '你行不行啊，说过几遍了还是崩，我真的很失望', at: Date.now() }])
  const f = e.read()
  ok(f.emotions.length > 0, '强负性该有情绪标签')
  ok(f.emotions.every(x => ['心痛', '委屈', '厌烦', '生气', '失望', '焦虑', '内疚', '羞耻'].includes(x.kind)), `负性场景不该出正面情绪：${f.emotions.map(x => x.kind)}`)
  // 共存要有主次：不能几个都顶到 1
  for (let i = 1; i < f.emotions.length; i++) {
    ok(f.emotions[i].intensity < f.emotions[i - 1].intensity, `共存情绪要分主次：${f.emotions.map(x => x.kind + x.intensity.toFixed(2)).join(' ')}`)
  }
}

// 8. 输出：情绪差时话更短、表情包更少；且不是瞬跳
{
  const a = mk(); a.say('你行不行啊，说过几遍了还是崩，我真的很失望')
  const fBad = a.e.read()
  const b = mk(); b.say('今天天气不错')
  const fGood = b.e.read()
  ok(fBad.io.brevity >= fGood.io.brevity - 0.05, `情绪差时不该更啰嗦（${fBad.io.brevity.toFixed(2)} vs ${fGood.io.brevity.toFixed(2)}）`)
  ok(fBad.io.meme.probability <= fGood.io.meme.probability + 0.05, '情绪差时表情包倾向不该更高')
  ok(fBad.io.brevity > 0 && fBad.io.brevity < 1, 'brevity 应落在中间值，不能瞬跳')
}

// 9. 注入：4-7 行、无阿拉伯数字、记忆行是原话
{
  const { e } = mk()
  e.tick([{ type: 'user', text: '你行不行啊，又崩了', at: Date.now() }])
  const txt = render(e.read(), { hour: 23, tick: 3 })
  const lines = txt.split('\n').filter(Boolean)
  ok(lines.length >= 4 && lines.length <= 7, `注入该 4-7 行，实际 ${lines.length}`)
  ok(!/[0-9]/.test(txt.replace(/这事以前有过.*/g, '')), '除记忆引用外不该出现阿拉伯数字')
}

// 10. 心情：负性会压下去，安静会缓回来
{
  const { e, go } = mk()
  const m0 = e.state.mood
  e.tick([{ type: 'user', text: '你行不行啊，说过几遍了还是崩', at: Date.now() }])
  const m1 = e.state.mood
  ok(m1 < m0, `被顶之后心情该降（${m0.toFixed(2)} → ${m1.toFixed(2)}）`)
  for (let i = 0; i < 6; i++) { go(30); e.tick([]) }
  ok(e.state.mood > m1, '安静一阵子心情该回一点')
}

// 11. 多轮配对：软化会把话往长了拉
{
  const { e, go, say } = mk()
  say('你行不行啊，说过几遍了还是崩')
  go(3); e.tick([{ type: 'assistant', text: '我在改。', at: Date.now() }])
  const before = e.read().io.brevity
  go(3); say('对不起，是我催太急了，你别急')
  const after = e.read().io.brevity
  ok(after <= before + 0.02, `软化之后不该更短（${before.toFixed(2)} → ${after.toFixed(2)}）`)
  ok(e.read().pair?.softening === true, '应识别出软化')
}

console.log(fails.length ? `FAIL ${fails.length}:\n- ${fails.join('\n- ')}` : 'PASS 十一个器官/通道都按各自输入动了（不是只有数据）')
process.exit(fails.length ? 1 : 0)

