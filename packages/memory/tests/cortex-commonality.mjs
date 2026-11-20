// P2b：共性提炼不能把不相干的偏好粘成一条。
// 之前出现过「主人讨厌：鲸鱼贴纸那种风格、每次验收都要打开设置页很麻烦、别人骗我」
// ——四条没关系的东西被 join 成一句，看着像记忆，其实没法用。
import { findPatterns } from '../organs/cortex/lib/commonality.js'

let fail = 0
const ok = (c, m) => { if (!c) { fail++; console.log('FAIL', m) } else { console.log('  ok:', m) } }

const cell = (object, supportId = 'ep1') => ({
  subject: '主人',
  predicate: '讨厌',
  object,
  kind: 'preference',
  supportIds: [supportId],
})

// 1) 四个互不相干的偏好：不该升出一条大杂烩
const unrelated = [
  cell('鲸鱼贴纸那种风格'),
  cell('每次验收都要打开设置页很麻烦'),
  cell('别人骗我'),
  cell('香菜'),
]
const p1 = findPatterns(unrelated, { min: 3 })
ok(p1.length === 0, `不相干的偏好不该合并（实际 ${p1.length} 条：${p1.map((x) => x.object).join(' | ')}）`)

// 2) 真正相关的一组（共享"贴纸"）：可以升
const related = [
  cell('鲸鱼贴纸那种风格'),
  cell('鲸鱼贴纸的配色'),
  cell('贴纸那种画风'),
]
const p2 = findPatterns(related, { min: 3 })
ok(p2.length === 1, `相关的一组应升成 1 条（实际 ${p2.length}）`)
ok(String(p2[0]?.object || '').includes('贴纸'), '合并后的对象应保留共同主题')

// 3) 两组各 3 条互不相干：应该升成 2 条，而不是 1 条六个东西
const twoGroups = [
  ...related,
  cell('香菜'), cell('香菜味'), cell('香菜的气息'),
]
const p3 = findPatterns(twoGroups, { min: 3 })
ok(p3.length === 2, `两组应各升一条（实际 ${p3.length}）`)
ok(p3.every((x) => x.object.length < 40), '合并后的对象不该长成一整段')

// 4) 不够 min 的不升
ok(findPatterns([cell('香菜'), cell('香菜味')], { min: 3 }).length === 0, '不足 3 条不该升')

// 5) 证据链只带真正参与了合并的那几条
const p5 = findPatterns([
  { ...cell('鲸鱼贴纸那种风格', 'epA') },
  { ...cell('鲸鱼贴纸的配色', 'epB') },
  { ...cell('贴纸那种画风', 'epC') },
  { ...cell('香菜', 'epD') },
], { min: 3 })
ok(p5.length === 1 && !p5[0].supportIds.includes('epD'), '没参与合并的证据不该挂上去')

console.log(fail ? `FAIL ${fail}` : 'PASS 共性提炼（不相干不合并 / 相关才升 / 两组各一条 / 不足不升 / 证据只带相关）')
process.exit(fail ? 1 : 0)
