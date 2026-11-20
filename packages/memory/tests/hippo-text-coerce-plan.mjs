// 两个真 bug 的回归：
// 1) 上游把对象/数组当 text 传进来 → 以前存成 "[object Object]"
// 2) 「明天想去海边走走」这种先情态后动词的说法 → 以前抽不出计划
import { coerceText } from '../organs/hippocampus/lib/util.js'
import { extractEpisode } from '../organs/cortex/lib/extract.js'

let fail = 0
const ok = (c, m) => { if (!c) { fail++; console.log('FAIL', m) } else { console.log('  ok:', m) } }

// ── 1. 文本拆包 ──
ok(coerceText('普通字符串') === '普通字符串', '字符串原样返回')
ok(coerceText({ text: '对象里的文字' }) === '对象里的文字', '对象取 text 字段')
ok(coerceText({ content: 'content 字段' }) === 'content 字段', '对象取 content 字段')
ok(coerceText([{ text: '第一句' }, { text: '第二句' }]) === '第一句\n第二句', '数组按行拼接')
ok(coerceText({}) === '', '空对象返回空串（由调用方拒绝）')
ok(coerceText(null) === '', 'null 返回空串')
ok(coerceText(42) === '42', '数字转字符串')
ok(coerceText('[object Object]').startsWith('[object Object]'), '垃圾串原样返回，由 encode 拒绝')

// ── 2. 计划抽取 ──
// extractEpisode 返回的是"事实数组"，不是 {facts}；且它读 ep.summary / ep.text
const hasPlan = (t) => (extractEpisode({ summary: t, at: Date.now(), id: 'e1' }, {}) || []).some((f) => f.predicate === '计划')

ok(hasPlan('明天想去海边走走'), '「明天想去海边走走」要抽出计划')
ok(hasPlan('明天想去海边走走，顺便吃个海鲜'), '长一点的也要抽')
ok(hasPlan('周末去逛公园'), '「周末去逛公园」要抽')
ok(hasPlan('今晚想吃火锅'), '「今晚想吃火锅」要抽')
ok(hasPlan('明天早上七点二十起床去楼下买包子'), '原来的时间+动作组合不能坏')

// 负样本：问句、否定、假设都不许抽成计划
ok(!hasPlan('明天几点起床？'), '问句不许抽计划')
ok(!hasPlan('明天想去哪？'), '「想去哪」是问句，不许抽')
ok(!hasPlan('如果我明天去海边就好了'), '假设句不许抽')
ok(!hasPlan('明天不想出门'), '否定句不许抽')
ok(!hasPlan('今天好累'), '没有计划动作的句子不许抽')

console.log(fail ? `FAIL ${fail}` : 'PASS 文本拆包 + 计划抽取（对象/数组拆包、垃圾拒绝、正负样本）')
process.exit(fail ? 1 : 0)
