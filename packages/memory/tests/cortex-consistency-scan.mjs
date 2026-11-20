// 旧 vs 旧 的一致性校验：只标记，不改原条目；宁漏不可错。
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const TMP = mkdtempSync(join(tmpdir(), 'cortex-consistency-'))
process.env.CORTEX_DIR = TMP

const { CortexStore } = await import('../organs/cortex/lib/store.js')
const { scanConsistency } = await import('../organs/cortex/lib/consistency.js')

let fail = 0
const ok = (c, m) => { if (!c) { fail++; console.log('FAIL', m) } else { console.log('  ok:', m) } }

const store = new CortexStore()
const F = (id, subject, predicate, object, extra = {}) => store.put({
  id, kind: 'fact', subject, predicate, object, text: `${subject}${predicate}${object}`,
  state: 'fact', confidence: 0.9, ...extra,
})

// 真冲突：同主体同谓词、取值互斥
const a = F('f1', '主人', '住在', '威海')
const b = F('f2', '主人', '住在', '青岛')
// 多值谓词：同时讨厌两样东西不算冲突
F('f3', '主人', '讨厌', '香菜')
F('f4', '主人', '讨厌', '下雨')
// 子串包含：同一件事的两种说法
F('f5', '主人', '城市', '威海')
F('f6', '主人', '城市', '威海市')
// 假设层不判
F('f7', '主人', '生日', '3月2日', { state: 'hypothesis' })
F('f8', '主人', '生日', '5月9日', { state: 'hypothesis' })
// 不同主体不判
F('f9', '主人', '手机号', '13800000000')
F('f10', '朋友', '手机号', '13900000000')

// 名字类：同一个主语、不同名字 → 不该报（本名/昵称本来就多值）
F('n1', '我', '名字', '示例用户')
F('n2', '我', '名字', '鱼鱼')

const before = { state: a.state, confidence: a.confidence, object: a.object }

const first = await scanConsistency(store)
ok(first.length === 1, `应只记 1 条冲突（实际 ${first.length}: ${JSON.stringify(first)}）`)
ok(first[0]?.aId === 'f1' && first[0]?.bId === 'f2', '应是 f1 × f2 这一对')
ok(store.conflicts.length === 1, `冲突队列应有 1 条（实际 ${store.conflicts.length}）`)
ok(store.conflicts[0]?.reason === 'consistency', 'reason 应是 consistency')

// 只标记，不改原条目
ok(a.state === before.state && a.confidence === before.confidence && a.object === before.object, '原条目不该被改动')

// 幂等：同一对不重复记
const second = await scanConsistency(store)
ok(second.length === 0, `再扫一次不该重复记（实际 ${second.length}）`)
ok(store.conflicts.length === 1, '冲突队列仍应是 1 条')

// 空对象/空主语不判
F('f11', '主人', '籍贯', '')
const third = await scanConsistency(store)
ok(third.length === 0, '空取值不该判冲突')

rmSync(TMP, { recursive: true, force: true })
console.log(fail ? `FAIL ${fail}` : 'PASS 一致性扫描（真冲突记账 / 多值不误报 / 子串不误报 / 假设层不判 / 幂等 / 不改原条目）')
process.exit(fail ? 1 : 0)
