// X01 词汇：语气词习惯能不能量出来；没样本、没重复就不算
import { lexicon } from '../core/lexicon.js'

const fails = []
const ok = (c, m, d = '') => { if (!c) { fails.push(m + ' — ' + d); console.log('FAIL ' + m + (d ? ' — ' + d : '')) } }

// 没样本：不编
const none = lexicon([])
ok(none.hint === null && none.because === 'no-samples', '没样本不该编', JSON.stringify(none))
ok(none.banned.includes('首先'), '禁词表该一直有', JSON.stringify(none.banned))

// 爱用「呗」「啦」：能量出来
const chatty = lexicon(['那就这样呗', '知道啦，你别熬', '行呗，听你的', '好啦好啦'])
ok(chatty.particles.includes('呗') && chatty.particles.includes('啦'), '该量出呗和啦', JSON.stringify(chatty))
ok(/她爱用的语气词/.test(String(chatty.hint)), '提示格式不对', String(chatty.hint))
ok(/一条最多一个/.test(String(chatty.hint)), '语气词该限一个', String(chatty.hint))

// 只用了一次：不算习惯
const once = lexicon(['好呗'], 3)
ok(once.particles.length === 0 && once.because === 'no-particles', '一次不算习惯', JSON.stringify(once))
ok(/不太用语气词/.test(String(once.hint)), '不常用时要说明', String(once.hint))

// 禁词表内容
ok(chatty.banned.includes('作为一个AI'), '禁词表缺 AI 腔', JSON.stringify(chatty.banned))
ok(!/首先/.test(String(chatty.hint)) === false, '提示里该带禁词', String(chatty.hint))

// 脏数据
const junk = lexicon([null, 3, '', {}])
ok(junk.hint === null, '脏数据不该给', JSON.stringify(junk))

if (fails.length) process.exit(1)
console.log('PASS 词汇（无样本不编 / 量出她爱用的语气词 / 一次不算 / 提示限一个 / 禁词表 / 脏数据）')
