// 接线：输出通道算出来的东西，必须真的进注入文本
//
// 审计发现 io.brevity / io.punctuation / io.replyDelayMs 全代码零消费者：
// 算了、导出了、但"嘴上"那行是三句写死的话按轮次轮换。等于她的语气根本没被算出来。
//
//   node tests/inject-output-wiring.mjs
import { render } from '../core/inject.js'

const fails = []
const ok = (c, m) => { if (!c) fails.push(m) }

function fused(over = {}) {
  return {
    emotions: [{ kind: '委屈', intensity: 0.6 }],
    mood: -0.2,
    felt: { intensity: 0.5, qualities: ['沉'], location: '胸口' },
    display: { toneShift: 'hard', leakRisk: 0.2, brevity: 0.5, mask: 0.3 },
    recall: null,
    arousal: 0.5,
    attribution: { locus: 'circumstance' },
    io: { brevity: 0.3, punctuation: 'normal', replyDelayMs: 3000, memeTendency: 0.5, meme: { style: 'neutral', allow: true, probability: 0.5 } },
    needs: {},
    ...over,
  }
}

const mouthOf = (text) => String(text).split('\n').find((l) => l.startsWith('嘴上：')) || ''

// ── 1. 句长进文本 ────────────────────────────────────────
{
  const shortText = render(fused({ io: { brevity: 0.75, punctuation: 'normal', replyDelayMs: 3000 } }), { tick: 0 })
  const normalText = render(fused({ io: { brevity: 0.3, punctuation: 'normal', replyDelayMs: 3000 } }), { tick: 0 })
  ok(/短/.test(mouthOf(shortText)), `话长 0.75 时嘴上该说"短"，实际：${mouthOf(shortText)}`)
  ok(mouthOf(shortText) !== mouthOf(normalText), '句长变了，嘴上却一个字没变')
}

// ── 2. 标点进文本 ────────────────────────────────────────
{
  const flat = render(fused({ io: { brevity: 0.75, punctuation: 'flat', replyDelayMs: 3000 } }), { tick: 0 })
  const warm = render(fused({ io: { brevity: 0.3, punctuation: 'warm', replyDelayMs: 3000 } }), { tick: 0 })
  ok(/句号/.test(mouthOf(flat)), `flat 标点时该提句号，实际：${mouthOf(flat)}`)
  ok(/软/.test(mouthOf(warm)), `warm 标点时该说语气软，实际：${mouthOf(warm)}`)
}

// ── 3. 延迟进文本 ────────────────────────────────────────
{
  const slow = render(fused({ io: { brevity: 0.75, punctuation: 'flat', replyDelayMs: 90_000 } }), { tick: 0 })
  const fast = render(fused({ io: { brevity: 0.75, punctuation: 'flat', replyDelayMs: 3000 } }), { tick: 0 })
  ok(/慢/.test(mouthOf(slow)), `延迟大时该说回得慢，实际：${mouthOf(slow)}`)
  ok(!/慢/.test(mouthOf(fast)), `延迟小时不该说慢，实际：${mouthOf(fast)}`)
}

// ── 4. 硬约束：行数 4–7、无阿拉伯数字、不空 ───────────────
for (const over of [
  {},
  { io: { brevity: 0.9, punctuation: 'flat', replyDelayMs: 300_000 } },
  { emotions: [], mood: -0.5 },
  { emotions: [{ kind: '安心', intensity: 0.5 }], mood: 0.3, io: { brevity: 0.2, punctuation: 'warm', replyDelayMs: 0 } },
]) {
  const text = render(fused(over), { hour: 23, tick: 2 })
  const lines = text.split('\n').filter(Boolean)
  ok(lines.length >= 4 && lines.length <= 7, `行数越界：${lines.length}`)
  ok(!/[0-9]/.test(text), `出现了阿拉伯数字：${text}`)
  ok(lines.some((l) => l.startsWith('嘴上：')), '缺嘴上这一行')
}

// ── 5. 每轮要变：同一状态不同 tick，嘴上不能永远是同一句 ──
{
  const a = render(fused(), { tick: 0 })
  const b = render(fused(), { tick: 3 })
  const c = render(fused(), { tick: 6 })
  ok(new Set([mouthOf(a), mouthOf(b), mouthOf(c)]).size >= 2, '三拍里嘴上只有一种说法')
}

// ── 6. 需求族：渴/冷/失控/没意义 不能只有饿和困能说话 ─────
{
  const only = (k, v) => ({
    hunger: 0, thirst: 0, sleep: 0, warmth: 0, contact: 0, control: 0, meaning: 0, [k]: v,
  })
  const water = render(fused({ emotions: [], mood: 0, needs: only('thirst', 0.85) }), { tick: 1 })
  ok(/渴|水/.test(water), `渴了 0.85 却一个字没提：${water.replace(/\n/g, ' / ')}`)

  const cold = render(fused({ emotions: [], mood: 0, needs: only('warmth', 0.8) }), { tick: 1 })
  ok(/冷/.test(cold), `冷了 0.8 却没提：${cold.replace(/\n/g, ' / ')}`)

  const control = render(fused({ emotions: [], mood: 0, needs: only('control', 0.8) }), { tick: 1 })
  ok(/主/.test(control), `控制感被夺 0.8 却没提：${control.replace(/\n/g, ' / ')}`)

  const meaning = render(fused({ emotions: [], mood: 0, needs: only('meaning', 0.75) }), { tick: 1 })
  ok(/没劲|图什么/.test(meaning), `意义感缺 0.75 却没提：${meaning.replace(/\n/g, ' / ')}`)

  // 反向：需求都很低时，不许凭空说这些
  const calm = render(fused({ emotions: [], mood: 0, needs: only('hunger', 0.1) }), { tick: 1 })
  ok(!/渴|冷|做回主|没劲/.test(calm), `什么都不缺时反而编了需求：${calm.replace(/\n/g, ' / ')}`)
}

// ── 7. 表情包倾向/概率：不想发的时候，别硬凑一张 ─────────
{
  const low = render(fused({
    meme: { style: 'neutral', allow: true },
    io: { brevity: 0.3, punctuation: 'normal', replyDelayMs: 3000, memeTendency: 0.05, meme: { style: 'neutral', probability: 0.08, allow: true } },
  }), { tick: 1 })
  ok(/不想发/.test(low), `概率 0.08 时该说不想发，实际：${low.replace(/\n/g, ' / ')}`)

  const high = render(fused({
    meme: { style: 'neutral', allow: true },
    io: { brevity: 0.3, punctuation: 'normal', replyDelayMs: 3000, memeTendency: 0.8, meme: { style: 'neutral', probability: 0.9, allow: true } },
  }), { tick: 1 })
  ok(/想丢一张/.test(high), `概率 0.9 且中性时该想发，实际：${high.replace(/\n/g, ' / ')}`)

  const mid = render(fused({
    meme: { style: 'neutral', allow: true },
    io: { brevity: 0.3, punctuation: 'normal', replyDelayMs: 3000, memeTendency: 0.5, meme: { style: 'neutral', probability: 0.4, allow: true } },
  }), { tick: 1 })
  ok(!/不想发|想丢一张/.test(mid), `中间值不该下判断，实际：${mid.replace(/\n/g, ' / ')}`)
}

// ── 8. 说出来了轻一点：venting 高的时候嘴上要带出来 ───────
{
  const high = render(fused({
    io: { brevity: 0.3, punctuation: 'normal', replyDelayMs: 3000, venting: 0.8, meme: { style: 'neutral', probability: 0.4 } },
  }), { tick: 0 })
  const low = render(fused({
    io: { brevity: 0.3, punctuation: 'normal', replyDelayMs: 3000, venting: 0.05, meme: { style: 'neutral', probability: 0.4 } },
  }), { tick: 0 })
  ok(/松/.test(mouthOf(high)), `venting 0.8 该提"松一点"，实际：${mouthOf(high)}`)
  ok(!/松/.test(mouthOf(low)), `venting 0.05 不该提，实际：${mouthOf(low)}`)
}

if (fails.length) {
  console.log(`FAIL ${fails.length}:`)
  for (const f of fails) console.log(` - ${f}`)
  process.exit(1)
}
console.log('PASS 输出通道接线（句长/标点/延迟都进了嘴上那行；行数/数字/轮换约束未破）')
process.exit(0)
