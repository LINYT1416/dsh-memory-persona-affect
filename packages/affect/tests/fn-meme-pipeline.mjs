// O08 表情包全链路：io 判语境 → 注入行 → 模型能直接拿去调用 send_meme 的参数。
//
// 线上问题：注入里一直有"表情包：发一张丧的（搜：难过 低落）"，但对话里从来没有真的发出去。
// 诊断结论不是概率太低——旧门限 0.18/0.12 永远够不着（概率下限 0.35、倾向下限 0.35）；
// 问题在行文：那是心情旁白，没有宿主发送工具认的六类情绪词（happy/angry/sad/shy/confused/daily），
// 模型没法把它变成一次调用。这个测试同时盯"该发"和"不该发"：
//   1) 闲聊/夸人/撒娇：连续 10 拍，至少 6 拍出现可执行的表情包行（带六类之一）
//   2) 正事：连续 5 拍，表情包行 ≥4（主人要求正事也发，只要贴合当下心情）
//   3) 对方诉苦：连续 5 拍，表情包行 ≥4（同上，发贴合心情的）
//   4) 同一状态按拍换说法（J05），不是每拍抄同一句
//
//   node tests/fn-meme-pipeline.mjs

import { createEngine } from '../core/engine.js'
import { render } from '../core/inject.js'

const T0 = new Date('2026-11-19T14:00:00+08:00').getTime()
const EMO = /（(happy|angry|sad|shy|confused|daily)，/

const fails = []
let checks = 0
function ok(cond, msg, detail = '') {
  checks += 1
  if (cond) console.log(`ok: ${msg}${detail ? ' — ' + detail : ''}`)
  else { console.log(`FAIL ${msg}${detail ? ' — ' + detail : ''}`); fails.push(msg) }
}

function mk(persona = {}) {
  let t = T0
  const e = createEngine({ now: () => t, persona })
  return {
    e,
    say(text) {
      t += 60_000
      e.tick([{ type: 'user', text, at: t }])
      const f = e.read()
      const out = render(f, { hour: 14, tick: e.state.ticks })
      const lines = out.split('\n').filter(Boolean)
      return {
        f,
        text: out,
        lines,
        meme: lines.filter(l => l.startsWith('表情包：')),
        idx: lines.findIndex(l => l.startsWith('表情包：')),
      }
    },
  }
}

// ── 1. 闲聊 / 夸人 / 撒娇：10 拍里至少 6 拍给出可执行指令 ──
const CASUAL = [
  '在干嘛呢，我刚刚还想你了',
  '你今天真厉害，我可太喜欢了',
  '陪我说说话嘛，有点无聊',
  '我刚吃了碗面，真香',
  '你是不是又偷偷加班了',
  '给我讲个笑话嘛',
  '今天地铁挤死了哈哈哈',
  '我新买了个耳机，音质绝了',
  '你要是忙就先说一声，我等你',
  '晚安之前还想跟你聊两句',
]
const casual = mk()
const casualMemes = []
const casualRows = []
for (const s of CASUAL) {
  const r = casual.say(s)
  casualMemes.push(r.meme[0] || '')
  casualRows.push(`${r.f.io?.meme?.context}/${r.f.io?.meme?.allow ? 'allow' : 'deny'}/p=${Number(r.f.io?.meme?.probability ?? 0).toFixed(2)}`)
  ok(r.lines.length >= 4 && r.lines.length <= 7 && !/[0-9]/.test(r.text), `闲聊「${s}」注入仍是 4-7 行且无数字`, `${r.lines.length} 行`)
}
const casualHits = casualMemes.filter(Boolean)
ok(casualHits.length >= 6, `闲聊 10 拍里表情包行 ≥6`, `${casualHits.length}/10（${casualRows.join(' ')}）`)
ok(casualHits.every(l => EMO.test(l)), '每个表情包行都带六类之一的英文情绪词', casualHits[0] || '(无)')
ok(casualHits.every(l => /send_meme/.test(l)), '每个表情包行都给出可执行的 send_meme 指令', casualHits[0] || '(无)')
ok(casualHits.every(l => !/不想发图/.test(l)), '闲聊时不该出现"不想发图"')

// 行不被 J01 的 7 行上限挤掉：表情包永远在前三行
{
  const idxs = []
  const c2 = mk()
  for (const s of CASUAL) idxs.push(c2.say(s).idx)
  ok(idxs.every(i => i >= 0 && i <= 3), '表情包行排在注入前列（没被 7 行上限挤掉）', idxs.join(','))
}

// ── 2. 正事：5 拍，表情包行 ≤1 ──
const TASK = [
  '帮我查下这个报错',
  '这个函数怎么改，给我看下日志',
  '接口报错了，帮我定位一下',
  '文档在哪，发我一下路径',
  '这个依赖怎么装，命令是什么',
]
{
  const m = mk()
  let hits = 0
  const rows = []
  for (const s of TASK) {
    const r = m.say(s)
    hits += r.meme.length
    rows.push(`${r.f.io?.meme?.context}/${r.f.io?.meme?.allow ? 'allow' : 'deny'}`)
    ok(r.f.io?.meme?.allow === true, `正事「${s}」allow=true（主人要求正事也发）`, r.f.io?.meme?.context)
  }
  ok(hits >= 4, '正事 5 拍里表情包行 ≥4（主人要求：正事也发，只要贴合心情）', `${hits}/5（${rows.join(' ')}）`)
  ok(hits >= 4, '正事 5 拍里实际 ≥4 次（主人要求正事也发）', `${hits}/5`)
}

// ── 3. 对方诉苦：5 拍，0 次 ──
const PAIN = [
  '我今天特别难受，想哭',
  '心里堵得慌，撑不住了',
  '我好累，什么都不想干',
  '刚被骂了一顿，特别委屈',
  '睡不着，脑子里全是事',
]
{
  const m = mk()
  let hits = 0
  const rows = []
  for (const s of PAIN) {
    const r = m.say(s)
    hits += r.meme.length
    rows.push(`${r.f.io?.meme?.context}/${r.f.io?.meme?.allow ? 'allow' : 'deny'}`)
  }
  ok(hits >= 4, '对方诉苦 5 拍里表情包行 ≥4 次', `${hits}/5（${rows.join(' ')}）`)
}

// ── 4. 同一状态不每拍重复同一句（J05）──
{
  const seen = casualMemes.filter(Boolean)
  let adjacentSame = 0
  for (let i = 1; i < casualMemes.length; i++) {
    if (casualMemes[i] && casualMemes[i] === casualMemes[i - 1]) adjacentSame += 1
  }
  ok(adjacentSame === 0, '相邻两拍的表情包行不重复', `重复 ${adjacentSame} 处`)
  ok(new Set(seen).size >= 3, '10 拍里至少有 3 种说法（按拍轮换）', `不同说法 ${new Set(seen).size} 种`)
}

if (fails.length) {
  console.log(`\nFAIL ${fails.length}/${checks}`)
  for (const f of fails) console.log(' - ' + f)
  process.exit(1)
}
console.log(`\nPASS 表情包全链路（${checks} 项：闲聊 ${casualHits.length}/10 有指令，正事 ≥4/5，诉苦 ≥4/5，说法按拍换）`)
process.exit(0)
