// X02 节奏：长度必须是从她自己句子里量出来的，没有样本就闭嘴
import { rhythm } from '../core/rhythm.js'

const fails = []
const ok = (c, m, d = '') => { if (!c) { fails.push(m + ' — ' + d); console.log('FAIL ' + m + (d ? ' — ' + d : '')) } }

// 没有样本：不给指令
const none = rhythm({})
ok(none.hint === null && none.because === 'no-samples', '没样本不该编长度', JSON.stringify(none))

// 样本太少：也不给
const few = rhythm({ avgLen: 30, samples: 2 })
ok(few.hint === null, '样本不足不该给', JSON.stringify(few))

// 她的平均句长 26：目标约 23 字
const real = rhythm({ avgLen: 26, samples: 20, particleRate: 0 })
ok(real.maxChars === 23, '26 字应推成 23 字', JSON.stringify(real))
ok(/别超过 23 字/.test(String(real.hint)), '提示里该带具体字数', String(real.hint))
ok(/别硬加语气词/.test(String(real.hint)), '语气词率 0 时不该让人硬加', String(real.hint))

// 有语气词习惯：允许一个
const chatty = rhythm({ avgLen: 20, samples: 10, particleRate: 0.5 })
ok(chatty.maxChars === 18, '20 字应推成 18', JSON.stringify(chatty))
ok(/语气词最多一个/.test(String(chatty.hint)), '爱用语气词时该限一个', String(chatty.hint))

// 极短/极长都不越界
const tiny = rhythm({ avgLen: 2, samples: 5 })
ok(tiny.maxChars >= 8, '太短要兜底', JSON.stringify(tiny))
const long = rhythm({ avgLen: 200, samples: 5 })
ok(long.maxChars <= 60, '太长要封顶', JSON.stringify(long))

// 脏数据
const junk = rhythm({ avgLen: 'x', samples: NaN, particleRate: null })
ok(junk.hint === null, '脏数据不该给', JSON.stringify(junk))

if (fails.length) process.exit(1)
console.log('PASS 节奏（无样本不说 / 样本少不说 / 26→23 / 语气词率决定提示 / 上下限夹住 / 脏数据）')
