// S03 自传：只整理不编；去重、排序、少于一件事就不说话
import { biography } from '../core/autobio.js'

const fails = []
const ok = (c, m, d = '') => { if (!c) { fails.push(m + ' — ' + d); console.log('FAIL ' + m + (d ? ' — ' + d : '')) } }
const DAY = 24 * 60 * 60 * 1000
const t0 = Date.parse('2026-11-01T10:00:00Z')

// 没事件：不说
ok(biography([], t0).line === null, '没事件不该说', '')
// 只有一件事：不说（一条不算故事）
ok(biography([{ at: t0, text: '去了趟超市' }], t0).line === null, '一件事不算自传', '')

// 两件以上：给一条线
const eps = [
  { at: t0 + 10 * DAY, text: '把脚本改完了' },
  { at: t0, text: '搬到新住处' },
  { at: t0 + 5 * DAY, text: '开始学吉他' },
]
const b = biography(eps, t0 + 10 * DAY)
ok(typeof b.line === 'string' && /天/.test(b.line), '该给一条时间线', String(b.line))
ok(b.spanDays === 10, '跨度算错了', String(b.spanDays))
ok(/搬到新住处/.test(b.milestones[0]), '第一条该是最早的事', JSON.stringify(b.milestones))

// 重复摘要：去掉
const dup = [
  { at: t0, text: '搬到新住处，累死' },
  { at: t0 + 1000, text: '搬到新住处，累死' },
  { at: t0 + DAY, text: '开始学吉他' },
]
const bd = biography(dup, t0 + DAY)
ok(bd.count === 2, '重复的该去掉', String(bd.count))

// 乱序输入：输出要有序
const shuffled = [
  { at: t0 + 3 * DAY, text: '第三件' },
  { at: t0, text: '第一件' },
  { at: t0 + DAY, text: '第二件' },
]
const bs = biography(shuffled, t0 + 3 * DAY)
ok(bs.milestones[0].includes('第一件'), '该按时间排序', JSON.stringify(bs.milestones))

// 同一天的多件事：不算跨度，但仍然有一句
const sameDay = [
  { at: t0, text: '早上喝了咖啡' },
  { at: t0 + 2 * 60 * 60 * 1000, text: '晚上看了电影' },
]
const bsd = biography(sameDay, t0 + DAY)
ok(typeof bsd.line === 'string' && bsd.spanDays === 0, '同一天也该有一句', JSON.stringify(bsd))

// 脏数据：跳过不崩
const junk = biography([null, 3, { at: 'x', text: 'y' }, { at: t0, text: '真的' }, { at: t0 + DAY, text: '真的二' }], t0)
ok(junk.line !== null, '脏数据里挑出好的', JSON.stringify(junk))

if (fails.length) process.exit(1)
console.log('PASS 自传（没事件不说 / 一件不算 / 时间线+跨度 / 去重 / 排序 / 同一天也有句 / 脏数据）')
