// R12 对话者：有 speakerId 才分人；没有 id 一律当老熟人（不瞎猜）
import { createSpeakers } from '../core/speakers.js'

const fails = []
const ok = (c, m, d = '') => { if (!c) { fails.push(m + ' — ' + d); console.log('FAIL ' + m + (d ? ' — ' + d : '')) } }
const t0 = 1_800_000_000_000

const sp = createSpeakers()

// 没有 id：当熟人，不留"陌生人"痕迹
const noId = sp.note('', t0)
ok(noId.known === true && noId.firstTime === false, '没 id 不该当陌生人', JSON.stringify(noId))
ok(sp.line('') === null, '没 id 不该说"没聊过"', String(sp.line('')))

// 第一次见：陌生
const first = sp.note('u-1001', t0)
ok(first.known === false && first.firstTime === true, '第一次该算新面孔', JSON.stringify(first))
ok(/没聊过/.test(String(sp.line('u-1001'))), '该说一句客气话', String(sp.line('u-1001')))

// 第二次见：熟了，不再说
sp.note('u-1001', t0 + 1000)
ok(sp.line('u-1001') === null, '第二次不该再说没聊过', String(sp.line('u-1001')))

// 另一个人：各自独立
const other = sp.note('u-2002', t0 + 2000)
ok(other.firstTime === true, '不同 id 该分别计', JSON.stringify(other))
ok(sp.line('u-2002') !== null, '新面孔该说', String(sp.line('u-2002')))

// 主对话者：第一个出现的 id
ok(sp.snapshot().main === 'u-1001', '第一个出现的应是主对话者', JSON.stringify(sp.snapshot().main))

// 计数
const c3 = sp.note('u-1001', t0 + 3000)
ok(c3.count === 3, '计数不对', JSON.stringify(c3))

// 存档
const snap = sp.snapshot()
const sp2 = createSpeakers()
sp2.restore(snap)
ok(sp2.note('u-1001', t0 + 4000).known === true, '存档读回来丢了人', JSON.stringify(sp2.snapshot()))

// 脏数据
const junk = createSpeakers({ seen: 'x' })
ok(junk.note('u-1', t0).firstTime === true, '脏数据不该崩', JSON.stringify(junk.snapshot()))

if (fails.length) process.exit(1)
console.log('PASS 对话者（没 id 当熟人 / 首次算新面孔 / 二次不说 / 各自计 / 主对话者 / 计数 / 存档 / 脏数据）')
