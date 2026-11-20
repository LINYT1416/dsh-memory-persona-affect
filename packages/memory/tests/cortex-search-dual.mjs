// 双模式检索自检：关键词 + 向量真的合到一起，而不只是 semantics 里的函数能跑。
// 隔离 CORTEX_DIR，不碰生产库。
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const TMP = mkdtempSync(join(tmpdir(), 'cortex-dual-'))
process.env.CORTEX_DIR = TMP

const { CortexStore } = await import('../organs/cortex/lib/store.js')
const { makeCortex } = await import('../organs/cortex/lib/pipeline.js')
const { saveVectors, VEC_FILE } = await import('../organs/cortex/lib/semantic.js')
const fs = await import('node:fs')

let fail = 0
const ok = (c, m) => { if (!c) { fail++; console.log('FAIL', m) } else { console.log('  ok:', m) } }

// 假 embedding：主题向量，刻意和字面无关
function fakeEmbed(text) {
  const t = String(text)
  const topics = {
    住处: ['住', '威海', '城市', '搬家'],
    工作: ['工作', '上班', '公司'],
    饮食: ['吃', '面', '炸鸡'],
  }
  return Object.values(topics).map((keys) => (keys.some((k) => t.includes(k)) ? 1 : 0))
}

const store = new CortexStore()
store.put({ id: 'x1', text: '我住在威海', kind: 'fact', subject: '主人', predicate: '住在', object: '威海', confidence: 0.9, supportCount: 1 })
store.put({ id: 'x2', text: '我在公司上班', kind: 'fact', subject: '主人', predicate: '上班', object: '公司', confidence: 0.9 })
store.put({ id: 'x3', text: '我喜欢吃炸鸡', kind: 'preference', subject: '主人', predicate: '喜欢', object: '炸鸡', confidence: 0.9 })

const cortex = makeCortex({ store, adapters: {}, meta: {}, embedFn: fakeEmbed })

// 先把向量建好（模拟 tick 干的事）
const vecStore = { model: 'fake', dim: 0, vecs: {} }
for (const c of store.allCells()) vecStore.vecs[c.id] = fakeEmbed(c.text)
vecStore.dim = 3
saveVectors(vecStore)
ok(fs.existsSync(VEC_FILE), '向量文件应写入临时目录')

// 1) 有向量时：query 与目标文本零字面重叠，仍能靠向量召回
const r = await cortex.searchAsync('她住哪座城市', { k: 3 })
ok(r.vectorUsed === true, `应标记用了向量（实际 ${JSON.stringify({ vectorUsed: r.vectorUsed, vectorHits: r.vectorHits })}）`)
ok((r.hits || []).some((h) => (h.id || h.cellId) === 'x1'), `应召回住处那条（实际 ${(r.hits || []).map((h) => h.id || h.cellId).join(',')}）`)
ok((r.hits || []).some((h) => h.viaVector), '命中的条目应带 viaVector 标记')

// 2) 没有 embedFn：退回纯关键词，且不抛
const cortex2 = makeCortex({ store, adapters: {}, meta: {} })
const r2 = await cortex2.searchAsync('住在', { k: 3 })
ok(!r2.vectorUsed, '没有 embedFn 时不该标记用了向量')
ok(Array.isArray(r2.hits), '没有 embedFn 时仍应返回 hits')

// 3) 同步版还在（老调用方不受影响）
ok(typeof cortex.searchSync === 'function', 'searchSync 应保留')
const r3 = cortex.searchSync('住在', { k: 3 })
ok(Array.isArray(r3.hits), 'searchSync 应仍可用')

rmSync(TMP, { recursive: true, force: true })
console.log(fail ? `FAIL ${fail}` : 'PASS 双模式检索（向量召回 / viaVector 标记 / 无 embedFn 降级 / searchSync 兼容）')
process.exit(fail ? 1 : 0)
