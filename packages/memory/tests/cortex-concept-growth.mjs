// 概念不能自我繁殖：上一轮提炼出来的 concept 不能再参与下一轮提炼。
import { findPatterns, groupByPredicate } from '../organs/cortex/lib/commonality.js'

let fail = 0
const ok = (c, m) => { if (!c) { fail++; console.log('FAIL', m) } else { console.log('  ok:', m) } }

const pref = (object, id = 'ep1') => ({ subject: '主人', predicate: '讨厌', object, kind: 'preference', supportIds: [id] })

// 1) 提炼产物本身被排除在分组之外
const conceptCell = {
  subject: '主人', predicate: '讨厌', kind: 'concept', tags: ['pattern', 'concept'],
  object: '鲸鱼贴纸那种风格、每次验收都要打开设置页很麻烦、别人骗我',
  supportIds: Array.from({ length: 20 }, (_, i) => 'ep' + i),
}
const grouped = groupByPredicate([conceptCell, pref('香菜')])
const all = [...grouped.values()].flat()
ok(!all.some((c) => c.kind === 'concept'), 'concept 不该进入分组（否则会自我繁殖）')
ok(all.length === 1, `只该剩普通偏好（实际 ${all.length}）`)

// 2) 连续提炼三轮，结果不膨胀
let cells = [pref('鲸鱼贴纸那种风格', 'a'), pref('鲸鱼贴纸的配色', 'b'), pref('贴纸那种画风', 'c')]
const first = findPatterns(cells, { min: 3 })
ok(first.length === 1, '第一轮应升 1 条')
const grown = [...cells, ...first.map((c) => ({ ...c, kind: 'concept', tags: ['pattern', 'concept'] }))]
const second = findPatterns(grown, { min: 3 })
ok(second.length === 1, `第二轮仍应只升 1 条（实际 ${second.length}）`)
// 关键：第二轮产出的证据数不能是上一轮结果的累加
ok((second[0]?.supportIds || []).length <= 3, `证据不该滚雪球（实际 ${(second[0]?.supportIds || []).length}）`)
// 关键：文本不能出现重复拼接
const textRepeat = /(.{4,})\1/.test(String(second[0]?.text || ''))
ok(!textRepeat, '文本不该重复拼接')

// 3) 尾部标点归一：'香菜。' 与 '香菜' 算同一个
const p3 = findPatterns([pref('香菜'), pref('香菜。'), pref('香菜，'), pref('香菜味')], { min: 3 })
ok(p3.length === 0 || (p3[0].object.match(/香菜/g) || []).length <= 2, '归一后不该把同一条算成三条')

// 4) 正常三个确实不同的相关对象，仍然能升
const p4 = findPatterns([pref('下雨天'), pref('下雨的夜'), pref('下雨天出门')], { min: 3 })
ok(p4.length === 1, `相关的三条应升 1 条（实际 ${p4.length}）`)

console.log(fail ? `FAIL ${fail}` : 'PASS 概念不自我繁殖（排除自身 / 三轮不膨胀 / 证据不滚雪球 / 标点归一 / 正常仍能升）')
process.exit(fail ? 1 : 0)
