// 因果链：episode 巩固时写下的 causalWindow（前后事件窗口）必须真的被检索用上。
// 以前只写不读——20 条记忆有因果，图扩散和排序完全不知道。
// 注：causalSpread 定义在 recall 的闭包里，不能直接 import，
// 所以这里守卫"接线存在"，行为验证靠线上命中里出现 why=causal。
import { readFileSync } from 'node:fs'

const src = readFileSync('E:/memory/dsh-all/organs/hippocampus/lib/recall.js', 'utf8')

let fail = 0
const ok = (c, m) => { if (!c) { fail++; console.log('FAIL', m) } else { console.log('  ok:', m) } }

ok(/function causalSpread\(/.test(src), '要有 causalSpread')
ok(/ep\?\.causalWindow/.test(src), 'causalSpread 要读 episode 的 causalWindow')
ok(/why: 'causal'/.test(src), '来源要标 causal（可审计，能区分"没跑"和"跑了没找到")')
ok(/causalSpread\(bmHits/.test(src), '要在真实召回路径里被调用（不是只定义）')
ok(/entries\.push\(\{ list: causalHits/.test(src), '结果要进候选合并（不是算完丢掉）')
ok(!/export function causalSpread/.test(src), '闭包内的函数不许 export（会让整个模块语法失败）')

// 巩固侧必须继续写这个字段，否则读取端永远拿不到
const cons = readFileSync('E:/memory/dsh-all/organs/hippocampus/lib/consolidate.js', 'utf8')
ok(/ep\.causalWindow\s*=/.test(cons), '巩固时要写 causalWindow（读写两端都要在）')

console.log(fail ? `FAIL ${fail}` : 'PASS 因果链接线（定义/读取/标注/接入合并/非导出/写入端存在）')
process.exit(fail ? 1 : 0)
