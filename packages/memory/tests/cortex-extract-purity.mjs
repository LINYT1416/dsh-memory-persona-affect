// P2 自检：抽取不造假 + 升级不草率。
// 重点不是"抽得多"，而是"抽错的不能有"。前半段是负样本（必须抽不出），
// 后半段才是正样本（必须抽得出）。
import { extract, hersOnly, isUnsafeSentence } from '../organs/cortex/lib/extract.js'
import { shouldUpgrade, MIN_SPAN_MS } from '../organs/cortex/lib/anti-pollution.js'

let fail = 0
const ok = (c, m) => { if (!c) { fail++; console.log('FAIL', m) } else { console.log('  ok:', m) } }
const objs = (t) => extract(t, { episodeId: 'ep1', speaker: 'user' }).map((c) => c.object)

// ── 负样本：一条都不该抽出来 ──────────────────────────────
console.log('— 负样本（必须抽不出）—')

// 1) 我说的话不能被当成她的事实（合并文本里最关键的一条）
const merged = '她说：今天好累。\n我说：我一般十点就睡了，我住在威海，我是程序员。'
ok(hersOnly(merged) === '今天好累。', '应先切掉"我说的"部分')
ok(!objs(merged).includes('威海'), '我的话里的"住在威海"不该被抽成她的事实')
ok(!objs(merged).includes('程序员'), '我的话里的"我是程序员"不该被抽成她的事实')

// 2) 问句不抽
ok(objs('我一般几点睡觉？').length === 0, '问句不该抽')
ok(objs('你喜欢我吗').length === 0, '带"吗"的问句不该抽')

// 3) 假设句不抽
ok(objs('如果我喜欢下雨，就天天出门').length === 0, '假设句不该抽')

// 4) 引用别人的话不抽
ok(objs('她说我最喜欢吃面').length === 0, '引用她人说法不该抽')

// 5) 否定假设不抽
ok(objs('这不代表我喜欢她').length === 0, '否定假设不该抽')

// 6) 她是第二人称的句子（"你"）不抽成她的偏好
ok(objs('你一般几点睡').length === 0, '问你的句子不该抽')

// 7) 判断函数本身
ok(isUnsafeSentence('我该怎么办？'), '问号应判为不安全')
ok(!isUnsafeSentence('我一般十点睡'), '陈述句应判为安全')

// ── 正样本：该抽的必须抽出来 ──────────────────────────────
console.log('— 正样本（必须抽得出）—')
ok(objs('我一般十点就睡').includes('十点就睡'), `习惯句应抽出（实际 ${JSON.stringify(objs('我一般十点就睡'))}）`)
ok(objs('我喜欢雨天').includes('雨天'), '喜欢应抽出')
ok(objs('我住在威海').includes('威海'), '住址应抽出')
ok(objs('我明天要去医院复查').some((o) => o.includes('医院')), '计划应抽出')
ok(objs('我最近在学吉他').some((o) => o.includes('学吉他')), '正在做应抽出')
ok(objs('我会弹一点钢琴').some((o) => o.includes('弹一点钢琴')), '能做什么应抽出')

// 8) 合并文本里的"她说的"仍然要能抽
const merged2 = '她说：我一般十点睡。\n我说：好。'
ok(objs(merged2).includes('十点睡'), '切完之后她的话仍应能抽')
ok(!objs(merged2).some((o) => o === '好。'), '"我说"的内容不该被抽')

// ── 升级门槛 ────────────────────────────────────────────
console.log('— 升级门槛 —')
const DAY = 86400000
const base = { confidence: 0.9, retracted: false }

// 9) 一条证据不升级
ok(!shouldUpgrade({ ...base, evidenceCount: 1, firstSeen: 0, lastSeen: 0 }), '一条证据不该升级')

// 10) 同一天里两条证据不升级（这就是"一次对话改写长期记忆"）
const sameDay = { ...base, evidenceCount: 2, firstSeen: 1000, lastSeen: 1000 + 60 * 1000 }
ok(!shouldUpgrade(sameDay), '同一场对话说两遍不该升级')

// 11) 跨过 12 小时的两条证据才升级
const spread = { ...base, evidenceCount: 2, firstSeen: 1000, lastSeen: 1000 + MIN_SPAN_MS }
ok(shouldUpgrade(spread), '隔了 12 小时的两条证据应升级')

// 12) 三条证据直接升级（多次独立出现）
ok(shouldUpgrade({ ...base, evidenceCount: 3, firstSeen: 1000, lastSeen: 2000 }), '三条证据应直接升级')

// 13) 已作废的不升级
ok(!shouldUpgrade({ ...base, retracted: true, evidenceCount: 5 }), '作废的不该升级')

console.log(fail ? `FAIL ${fail}` : 'PASS P2（7 条负样本不造假 / 7 条正样本能抽 / 5 条升级门槛）')
process.exit(fail ? 1 : 0)
