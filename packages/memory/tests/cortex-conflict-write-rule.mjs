// 写入时的冲突判定：以前只要同主体、值不同就记，10 条里 9 条误报。
// 现在跟定期扫描共用 conflictingPair。这里把"该报的"和"不该报的"都钉住。
import { conflictingPair } from '../organs/cortex/lib/consistency.js'

let fail = 0
const ok = (c, m) => { if (!c) { fail++; console.log('FAIL', m) } else { console.log('  ok:', m) } }
const C = (o) => ({ state: 'fact', confidence: 0.9, kind: 'fact', ...o })

// 该报：同主体同谓词、取值互斥
ok(conflictingPair(C({ id: 'a', subject: '主人', predicate: '住在', object: '威海' }), C({ id: 'b', subject: '主人', predicate: '住在', object: '青岛' })) === true,
  '住在：威海 vs 青岛 → 冲突')

// 不该报：多值谓词（同时讨厌两样东西）
ok(conflictingPair(C({ id: 'a', subject: '主人', predicate: '讨厌', object: '香菜' }), C({ id: 'b', subject: '主人', predicate: '讨厌', object: '下雨' })) === false,
  '讨厌：香菜 vs 下雨 → 不冲突')

// 不该报：不同谓词（uid vs 身份）
ok(conflictingPair(C({ id: 'a', subject: '主人', predicate: '账号', object: '1000003' }), C({ id: 'b', subject: '主人', predicate: '是', object: '示例用户' })) === false,
  '不同谓词 → 不冲突')

// 不该报：同一句话
ok(conflictingPair(C({ id: 'a', subject: '主人', predicate: '住在', object: '威海' }), C({ id: 'b', subject: '主人', predicate: '住在', object: '威海' })) === false,
  '同一取值 → 不冲突')

// 不该报：子串包含（威海 / 威海市）
ok(conflictingPair(C({ id: 'a', subject: '主人', predicate: '城市', object: '威海' }), C({ id: 'b', subject: '主人', predicate: '城市', object: '威海市' })) === false,
  '子串包含 → 不冲突')

// 不该报：事件类（今天被裁 / 爸住院）
ok(conflictingPair(C({ id: 'a', subject: '主人', predicate: '经历', object: '领导谈话', kind: 'event' }), C({ id: 'b', subject: '主人', predicate: '经历', object: '爸住院', kind: 'event' })) === false,
  '事件类 → 不冲突')

// 不该报：假设层
ok(conflictingPair(C({ id: 'a', subject: '主人', predicate: '生日', object: '3月2日', state: 'hypothesis' }), C({ id: 'b', subject: '主人', predicate: '生日', object: '5月9日' })) === false,
  '假设层 → 不冲突')

// 不该报：置信度太低
ok(conflictingPair(C({ id: 'a', subject: '主人', predicate: '住在', object: '威海', confidence: 0.3 }), C({ id: 'b', subject: '主人', predicate: '住在', object: '青岛' })) === false,
  '低置信 → 不冲突')

// 不该报：自己跟自己
const self = C({ id: 'a', subject: '主人', predicate: '住在', object: '威海' })
ok(conflictingPair(self, self) === false, '自己跟自己 → 不冲突')

// 回归：主语都是"我"，但一个说主人本名、一个说 AI 的名字——不是互斥
ok(conflictingPair(C({ id: 'a', subject: '我', predicate: '名字', object: '示例用户' }), C({ id: 'b', subject: '我', predicate: '名字', object: '鱼鱼' })) === false,
  '名字类：示例用户 vs 鱼鱼 → 不冲突（主语代词未消解）')

console.log(fail ? `FAIL ${fail}` : 'PASS 写入冲突规则（该报的 1 条全中 / 不该报的 8 条全拦）')
process.exit(fail ? 1 : 0)
