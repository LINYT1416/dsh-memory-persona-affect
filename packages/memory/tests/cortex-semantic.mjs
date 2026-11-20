// 皮层向量通道自检。必须隔离 CORTEX_DIR，绝不碰生产 vectors.json。
import { mkdtempSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const TMP = mkdtempSync(join(tmpdir(), 'cortex-semantic-'))
process.env.CORTEX_DIR = TMP

const { cosine, ensureVectors, searchByVector, blend, loadVectors, saveVectors, VEC_FILE } = await import('../organs/cortex/lib/semantic.js')

let fail = 0
const ok = (c, m) => { if (!c) { fail++; console.log('FAIL', m) } else { console.log('  ok:', m) } }

const TOPICS = ['住处', '工作', '情绪', '饮食', '作息']
function fakeEmbed(text) {
  const t = String(text)
  return TOPICS.map((topic) => {
    const keys = {
      住处: ['住', '威海', '城市', '搬家', '家'],
      工作: ['工作', '上班', '公司', '实习', '项目'],
      情绪: ['难受', '烦', '开心', '失望', '委屈'],
      饮食: ['吃', '面', '饭', '炸鸡', '火锅'],
      作息: ['睡', '熬夜', '起床', '几点'],
    }[topic]
    return keys.some((k) => t.includes(k)) ? 1 : 0
  })
}

ok(VEC_FILE.startsWith(TMP), `向量文件应在临时目录（实际 ${VEC_FILE}）`)

ok(cosine([1, 0], [1, 0]) === 1, '同向余弦应为 1')
ok(cosine([1, 0], [0, 1]) === 0, '正交余弦应为 0')
ok(cosine([], [1]) === 0, '空向量应为 0')

const cells = [
  { id: 'c1', text: '我住在威海' },
  { id: 'c2', text: '我在公司上班' },
  { id: 'c3', text: '我一般十点睡' },
]
const store = { model: 'fake', dim: 0, vecs: {} }
const r1 = await ensureVectors(cells, { embedFn: fakeEmbed, store, limit: 2 })
ok(r1.built === 2, `第一次应只建 2 条（实际 ${r1.built}）`)
ok(r1.remaining === 1, `应还剩 1 条（实际 ${r1.remaining}）`)
const r2 = await ensureVectors(cells, { embedFn: fakeEmbed, store, limit: 2 })
ok(r2.built === 1, `第二次应补 1 条（实际 ${r2.built}）`)
const r3 = await ensureVectors(cells, { embedFn: fakeEmbed, store, limit: 2 })
ok(r3.built === 0, '都建过了不该重复建')
ok(store.dim === 5, `维度应记下来（实际 ${store.dim}）`)

// 落盘 + 读回（真持久化，不是只在内存）
ok(existsSync(VEC_FILE), '待落盘的向量文件应存在')
saveVectors(store)
const back = loadVectors()
ok(Object.keys(back.vecs || {}).length === 3, `读回应有 3 条（实际 ${Object.keys(back.vecs || {}).length}）`)
ok(back.dim === 5, '读回维度应一致')

const hits = await searchByVector('她住哪座城市', cells, { embedFn: fakeEmbed, store })
ok(hits.length === 1 && hits[0].id === 'c1', `应召回住处那条（实际 ${JSON.stringify(hits)}）`)

const none = await searchByVector('今天股票涨了', cells, { embedFn: fakeEmbed, store, minScore: 0.3 })
ok(none.length === 0, `不相干不该召回（实际 ${JSON.stringify(none)}）`)

const kw = [{ id: 'c2', score: 1.0 }, { id: 'c1', score: 0.2 }]
const vec = [{ id: 'c1', score: 0.9 }, { id: 'c3', score: 0.5 }]
const merged = blend(kw, vec, { weight: 0.35 })
const both = merged.find((x) => x.id === 'c1')
ok(both.score > 0.2, `两边命中应被加权（0.2 → ${both.score.toFixed(2)}）`)
ok(both.viaVector === true && both.vectorScore === 0.9, '两边命中应记下向量分')
ok(merged.some((x) => x.id === 'c3' && x.only === 'vector'), '只有向量命中的应保留并标记')
const c3 = merged.find((x) => x.id === 'c3')
const c2 = merged.find((x) => x.id === 'c2')
ok(c3.score < c2.score, `纯向量命中应压一档（c3=${c3.score.toFixed(2)} c2=${c2.score.toFixed(2)}）`)
ok(merged.every((x, i) => i === 0 || merged[i - 1].score >= x.score), '结果应降序')

ok((await searchByVector('x', cells, { store })).length === 0, '没有 embedFn 应返回空而不是抛错')
const r4 = await ensureVectors(cells, { store })
ok(r4.skipped === 'no-embed', '没有 embedFn 应标记 skipped')
ok(loadVectors(join(TMP, '__nope__.json')).vecs && true, '读不到应返回空结构')

// persist:false 不写盘
const store2 = { model: 'fake', dim: 0, vecs: {} }
await ensureVectors([{ id: 'z1', text: '吃面' }], { embedFn: fakeEmbed, store: store2, persist: false })
ok(Object.keys(loadVectors().vecs || {}).length === 3, 'persist:false 不该写盘')

rmSync(TMP, { recursive: true, force: true })
console.log(fail ? `FAIL ${fail}` : 'PASS P3（隔离目录 / 余弦 / 限量建向量 / 落盘读回 / 语义召回 / 阈值 / blend / 降级 / persist）')
process.exit(fail ? 1 : 0)
