// 作废的 episode 不许出现在召回索引里。
// 背景：index.jsonl 是 append-only，光在 episodes 里标 retracted 不够，
// 旧索引行仍在，召回会命中（实测 3 条 [object Object] 垃圾还在 index 里）。
import { filterRetracted } from '../organs/hippocampus/lib/recall.js'

let fail = 0
const ok = (c, m) => { if (!c) { fail++; console.log('FAIL', m) } else { console.log('  ok:', m) } }

const rows = [
  { episodeId: 'keep1', summary: '正常记忆' },
  { episodeId: 'gone1', summary: '[object Object]' },
  { episodeId: 'ghost1', summary: '索引有、episode 没了' },
  { id: 'keep2', summary: '用 id 字段的行' },
]
const eps = {
  keep1: { id: 'keep1', state: 'consolidated' },
  gone1: { id: 'gone1', state: 'retracted' },
  // ghost1 故意不放：episode 已不存在时不许连索引一起丢（宁可留，不可错删）
  keep2: { id: 'keep2', state: 'open' },
}

const out = filterRetracted(rows, (id) => eps[id] || null)
const ids = out.map((r) => r.episodeId || r.id)

ok(!ids.includes('gone1'), 'retracted 的必须被滤掉')
ok(ids.includes('keep1'), 'normal 的要留')
ok(ids.includes('ghost1'), 'episode 不存在的行要留（不许误删）')
ok(ids.includes('keep2'), '用 id 字段的行也要认')
ok(out.length === 3, `应剩 3 条（实际 ${out.length}）`)

// getEp 抛错时不许把整批吞掉
const safe = filterRetracted(rows, () => { throw new Error('boom') })
ok(safe.length === rows.length, 'getEp 抛错时保留全部，不许因异常清空索引')

console.log(fail ? `FAIL ${fail}` : 'PASS 召回过滤（retracted 剔除 / 缺失保留 / id 字段兼容 / 异常不清空）')
process.exit(fail ? 1 : 0)
