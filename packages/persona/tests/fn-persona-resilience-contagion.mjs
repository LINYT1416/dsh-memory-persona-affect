// T07 复原力 + E10 情绪传染：两条一起验
import { resilience, recover } from '../core/resilience.js'
import { contagion } from '../core/contagion.js'

const fails = []
const ok = (c, m, d = '') => { if (!c) { fails.push(m + ' — ' + d); console.log('FAIL ' + m + (d ? ' — ' + d : '')) } }

// ── T07 复原力 ──
const alone = resilience({ intimacy: 0.1, apologies: 0 })
const close = resilience({ intimacy: 0.9, apologies: 2 })
ok(close.multiplier > alone.multiplier, '有人在旁边该恢复更快', alone.multiplier + ' vs ' + close.multiplier)
ok(alone.multiplier >= 0.6 && close.multiplier <= 1.6, '倍率该被夹在 0.6~1.6', alone.multiplier + ',' + close.multiplier)
ok(alone.because === 'alone' && close.because === 'supported', '支持状态判断不对', alone.because + '/' + close.because)

// 同样的时间：有人接着的爬回来更多
const v0 = 0.1
const slow = recover(v0, 24, alone.multiplier)
const fast = recover(v0, 24, close.multiplier)
ok(fast > slow, '有人接着该回得更快', slow + ' vs ' + fast)
ok(fast < 0.5, '一天之内不该直接回到基线', String(fast))
ok(recover(0.5, 24, 1) === 0.5, '本来就在基线不该动', '')
ok(recover(0.1, 0, 1) === 0.1, '零小时不该变', '')

// 脏数据
ok(Number.isFinite(recover('x', 'y', 'z')), '脏数据该给数', '')

// ── E10 情绪传染 ──
const angry = contagion('闭嘴吧你烦不烦')
ok(angry.delta < 0 && angry.from === 'angry', '对方发火该被带下去', JSON.stringify(angry))
const vent = contagion('今天好累，撑不住了')
ok(vent.delta < 0, '对方诉苦也该被带一点', JSON.stringify(vent))
const play = contagion('哈哈笑死我了')
ok(play.delta > 0, '对方开心该被带起来', JSON.stringify(play))
const serious = contagion('帮我看下这个报错')
ok(serious.delta === 0 && serious.because === 'neutral', '正事不该被传染', JSON.stringify(serious))
const flat = contagion('嗯')
ok(flat.delta === 0, '平常不该被传染', JSON.stringify(flat))

// 传染有上限：对方再炸也只带一点
ok(angry.delta >= -0.12, '传染幅度该有上限', String(angry.delta))
ok(play.delta <= 0.06, '正向也有上限', String(play.delta))

if (fails.length) process.exit(1)
console.log('PASS 复原力+情绪传染（有人接着回得快 / 倍率有界 / 一天回不满 / 发火带下去 / 开心带起来 / 正事不传染 / 幅度有上限）')
