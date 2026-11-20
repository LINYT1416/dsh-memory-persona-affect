// 两件事的回归：
// 1) 数值冲突必须同主体+同类型，不能靠"共享一句碎片 + 数字不同"就报（实测误报过一次）
// 2) 定时器不可靠（宿主节流），清理必须能在工具调用时惰性补跑
import { readFileSync } from 'node:fs'
import { scan } from '../organs/prefrontal/kernel/conflict.js'

let fail = 0
const ok = (c, m) => { if (!c) { fail++; console.log('FAIL', m) } else { console.log('  ok:', m) } }

const E = (o) => ({ episodeId: 'e' + Math.random().toString(36).slice(2, 6), entities: ['某人'], summary: '', type: '事实', slots: { who: 'user' }, ...o })

// ── 不该报 ──
const fpA = E({ summary: '重启完了 4 次', entities: ['重启完了'], slots: { who: '' } })
const fpB = E({ summary: '重启完了 3 次', entities: ['重启完了'], slots: { who: '' } })
ok(scan([fpA, fpB]).filter((p) => p.field === 'number').length === 0, '共享句子碎片 + 无主体 → 不报数值冲突')

const tA = E({ summary: '主人身高 180', type: '事实', slots: { who: 'user' } })
const tB = E({ summary: '主人身高 175', type: '偏好', slots: { who: 'user' } })
ok(scan([tA, tB]).filter((p) => p.field === 'number').length === 0, '主体相同但类型不同 → 不报')

const longA = E({ summary: '这周跑了 4 公里那条路特别绕而且天黑', entities: ['这周跑了 4 公里那条路特别绕而且天黑'], slots: { who: 'user' } })
const longB = E({ summary: '这周跑了 3 公里那条路特别绕而且天黑', entities: ['这周跑了 3 公里那条路特别绕而且天黑'], slots: { who: 'user' } })
ok(scan([longA, longB]).filter((p) => p.field === 'number').length === 0, '实体是长句碎片 → 不报')

// ── 该报 ──
const gA = E({ summary: '主人身高 180', entities: ['主人'], type: '事实', slots: { who: 'user' } })
const gB = E({ summary: '主人身高 175', entities: ['主人'], type: '事实', slots: { who: 'user' } })
const got = scan([gA, gB]).filter((p) => p.field === 'number')
ok(got.length === 1, `同主体同类型的真数值冲突要报（实际 ${got.length} 条）`)
ok(got[0]?.values?.join(',') === '180,175', '值的顺序要能对上')

// ── 惰性补跑接线（源码护栏）──
const idx = readFileSync('E:/memory/dsh-all/organs/prefrontal/index.js', 'utf8')
ok(/function ensureTidyFresh/.test(idx), '要有 ensureTidyFresh')
ok(/ensureTidyFresh\('judge'\)/.test(idx), 'judge 入口要补跑')
ok(/ensureTidyFresh\('plan'\)/.test(idx), 'plan 入口要补跑')
ok(/runTidyNow/.test(idx), '定时器与惰性路径要共用同一套清理')

console.log(fail ? `FAIL ${fail}` : 'PASS 冲突收紧 + 惰性补跑（误报拦 / 真冲突报 / 入口接线）')
process.exit(fail ? 1 : 0)
