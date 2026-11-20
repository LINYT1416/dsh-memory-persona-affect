// S09 自我一致：同一天改口要承认；隔一天可以改，但也要留旧值
import { createConsistency } from '../core/consistency.js'

const fails = []
const ok = (c, m, d = '') => { if (!c) { fails.push(m + ' — ' + d); console.log('FAIL ' + m + (d ? ' — ' + d : '')) } }
const t0 = 1_800_000_000_000
const DAY = 24 * 60 * 60 * 1000

const c = createConsistency()

// 第一次说：不算改口
const first = c.say('今晚出门', '不去', t0)
ok(first.changed === false && first.line === null, '第一次说不是改口', JSON.stringify(first))

// 同一天重复同样的说法：不吭声
const same = c.say('今晚出门', '不去', t0 + 1000)
ok(same.changed === false && same.line === null, '说法没变不该吭声', JSON.stringify(same))

// 同一天换说法：必须承认
const flip = c.say('今晚出门', '去', t0 + 2000)
ok(flip.changed === true && /改主意了/.test(String(flip.line)), '改口要承认', JSON.stringify(flip))
ok(flip.previous === '不去', '要记住原来的说法', JSON.stringify(flip))

// 改完之后：新说法成为当前说法
const after = c.say('今晚出门', '去', t0 + 3000)
ok(after.changed === false, '改完再重复不该反复念', JSON.stringify(after))

// 隔一天再换：不算"一天内改口"，但旧值仍能看到
const nextDay = c.say('今晚出门', '不去', t0 + 2 * DAY)
ok(nextDay.changed === false, '隔天改主意不该报"改口"', JSON.stringify(nextDay))
ok(nextDay.previous === '去', '隔天也要能追溯上次说法', JSON.stringify(nextDay))

// 不同的事各记各的
const other = c.say('周末爬山', '去', t0 + 2 * DAY + 1000)
ok(other.changed === false, '不同的事不该互相影响', JSON.stringify(other))

// 空 key：不记
const empty = c.say('', '随便', t0)
ok(empty.changed === false && empty.line === null, '空 key 不该记', JSON.stringify(empty))

// 存档
const snap = c.snapshot()
const c2 = createConsistency()
c2.restore(snap)
const again = c2.say('今晚出门', '不去', t0 + 2 * DAY + 2000)
ok(again.changed === false, '存档读回来丢了"当前说法"', JSON.stringify(again))

// 脏数据
const junk = createConsistency({ stances: 'x' })
ok(junk.say('a', 'b', t0).changed === false, '脏数据不该乱报改口', '')

if (fails.length) process.exit(1)
console.log('PASS 自我一致（首次不算改口 / 重复不吭声 / 同日改口要承认 / 新说法生效 / 隔天可改且可追溯 / 各记各的 / 空 key / 存档 / 脏数据）')
