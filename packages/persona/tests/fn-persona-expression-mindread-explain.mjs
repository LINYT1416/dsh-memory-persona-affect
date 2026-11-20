// E07 表达规则 / E08 共情认知 / E11 解释风格 / E12 怀旧
import { expressionRule } from '../core/expression.js'
import { mindread } from '../core/mindread.js'
import { explainStyle, nostalgia } from '../core/explain.js'

const fails = []
const ok = (c, m, d = '') => { if (!c) { fails.push(m + ' — ' + d); console.log('FAIL ' + m + (d ? ' — ' + d : '')) } }
const DAY = 86400000

// E07：场合不允许就不摆脸色
const formalHot = expressionRule('我在开会，一会再说', { tpj: { offense: 0.8 } })
ok(formalHot.mask === true, '开会时该收着', JSON.stringify(formalHot))
ok(/不合适|不适合/.test(String(formalHot.line)), '收着的话要说明白', String(formalHot.line))
const privateHot = expressionRule('就我们俩，随便说', { tpj: { offense: 0.8 } })
ok(privateHot.mask === false, '私下该发作就发作', JSON.stringify(privateHot))
ok(expressionRule('今天吃什么', {}).mask === false, '平常没规则', '')
// 情绪不强时，正式场合也不必装
ok(expressionRule('在开会', { tpj: { offense: 0.1 } }).mask === true, '正式场合仍然收着（只是不说重话）', '')

// E08：猜对方怎么想
const m1 = mindread('我觉得他根本不在乎我')
ok(m1.guessed === true, '该察觉在说"谁怎么想"', JSON.stringify(m1))
ok(m1.who === 'other', '说的是别人该认出是别人', JSON.stringify(m1))
ok(String(m1.belief || '').length > 0, '该带出对方的说法', String(m1.belief))
ok(mindread('今天吃什么').guessed === false, '闲聊不猜心', '')
const m2 = mindread('我以为你会生气')
ok(m2.guessed === true && m2.who === 'you', '说的是我该认出是我', JSON.stringify(m2))

// E11：解释风格随底子变
const good = explainStyle('项目黄了', { mpfc: { esteem: 0.8 } })
ok(good.frame === 'benign', '底子好时能往宽里想', JSON.stringify(good))
const bad = explainStyle('项目黄了', { mpfc: { esteem: 0.2 } })
ok(bad.frame === 'threat', '底子差时往坏里想', JSON.stringify(bad))
const crisis = explainStyle('项目黄了', { mpfc: { esteem: 0.9 }, pcc: { crisis: 0.8 } })
ok(crisis.frame === 'threat', '崩着时不许自我安慰', JSON.stringify(crisis))
ok(explainStyle('', {}).line === null, '没内容不多嘴', '')

// E12：怀旧只对旧事
const oldEps = [{ at: Date.now() - 10 * DAY, text: '第一次一起去吃面' }, { at: Date.now() - DAY, text: '昨天的事' }]
const nost = nostalgia(oldEps)
ok(nost.nostalgic === true, '十天的旧事该怀旧', JSON.stringify(nost))
ok(/第一次一起去吃面/.test(String(nost.line)), '该提旧的那件', String(nost.line))
ok(nostalgia([{ at: Date.now() - DAY, text: '昨天的事' }]).nostalgic === false, '昨天的不算怀旧', '')
ok(nostalgia([]).nostalgic === false, '没旧事不该怀旧', '')
ok(nostalgia([{ at: 'x', text: 'y' }]).nostalgic === false, '脏数据不该怀旧', '')

if (fails.length) process.exit(1)
console.log('PASS 表达规则+共情认知+解释风格+怀旧（开会收着/私下发作；猜心不带私货；底子差往坏想、崩着不自欺；十天旧事才怀旧）')
