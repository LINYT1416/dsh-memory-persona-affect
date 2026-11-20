// H03 渴求与上瘾：同一个东西提三次，才会承认"有点忍不住"
import { createCrave } from '../core/crave.js'

const fails = []
const ok = (c, m, d = '') => { if (!c) { fails.push(m + ' — ' + d); console.log('FAIL ' + m + (d ? ' — ' + d : '')) } }
const t0 = 1_800_000_000_000

const c = createCrave()
// 没提：什么都不说
ok(c.line(t0) === null, '没提过不该说', String(c.line(t0)))

// 一次：不够
c.note('我想喝咖啡', t0)
ok(c.line(t0 + 1000) === null, '一次不够', String(c.line(t0 + 1000)))

// 两次：还不够
c.note('今天还没喝咖啡', t0 + 2000)
ok(c.line(t0 + 3000) === null, '两次不够', String(c.line(t0 + 3000)))

// 三次：够了
c.note('又在想咖啡', t0 + 4000)
const line = c.line(t0 + 5000)
ok(typeof line === 'string' && /咖啡/.test(line), '三次该承认了', String(line))

// 说完清账，不再连着念
ok(c.line(t0 + 6000) === null, '说完不该接着念', String(c.line(t0 + 6000)))

// 三小时内冷却
c.note('咖啡', t0 + 7000); c.note('咖啡', t0 + 8000); c.note('咖啡', t0 + 9000)
ok(c.line(t0 + 10_000) === null, '冷却内不该再说', String(c.line(t0 + 10_000)))

// 窗口过期：超过两小时的旧计数不算
const d = createCrave()
d.note('奶茶', t0); d.note('奶茶', t0 + 1000)
ok(d.line(t0 + 3 * 60 * 60 * 1000) === null, '过了窗口不该算旧账', String(d.line(t0 + 3 * 60 * 60 * 1000)))

// 不同话题不混算
const e = createCrave()
e.note('咖啡', t0); e.note('奶茶', t0 + 1000); e.note('游戏', t0 + 2000)
ok(e.line(t0 + 3000) === null, '不同东西不该加在一起', String(e.line(t0 + 3000)))

// 存档
const snap = c.snapshot()
const f = createCrave()
f.restore(snap)
ok(typeof f.snapshot().counts === 'object', '存档读回来形状不对', JSON.stringify(f.snapshot()))

if (fails.length) process.exit(1)
console.log('PASS 渴求与上瘾（一次/两次不够；三次才说；说完清账；冷却三小时；窗口过期；不同东西不混算）')
