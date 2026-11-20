// 人格 ← 记忆：新版记忆（dsh-all）不 provide 服务，只写盘；桥必须有磁盘退路，且不许伪造
//   node tests/integration-memory.mjs
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createMemoryBridge } from '../bridge/memory.js'

const home = mkdtempSync(join(tmpdir(), 'mem-'))
process.env.HIPPOCAMPUS_DIR = home
const fails = []
const ok = (c, m, d = '') => { if (!c) { fails.push(m + ' — ' + d); console.log('FAIL ' + m + ' — ' + d) } }

const rows = [
  { brief: '明天想去海边走走，顺便吃个海鲜', valence: 0.5, at: 1, type: 'user' },
  { brief: '晚上改表格改到很晚，有点累', valence: -0.3, at: 2, type: 'user' },
  { summary: '【情绪】委屈：他说"你行不行啊"', valence: -0.6, at: 3, type: 'emotion' },
]
writeFileSync(join(home, 'episodes.jsonl'), rows.map((r) => JSON.stringify(r)).join('\n'), 'utf8')

const bridge = createMemoryBridge(() => null)   // 没有 memory.hippocampus 服务
ok(bridge.present() === false, 'present() 在没有服务时应该是 false')

const r = await bridge.refresh(6)
ok(r?.ok === true, 'refresh 应该走磁盘退路成功', JSON.stringify(r))
ok(r?.source === 'disk', '应该标明来源是磁盘', JSON.stringify(r))

const eps = bridge.episodes()
ok(eps.length === 2, '应该拿到 2 条真实记忆（情绪那条要挡掉）', String(eps.length))
const texts = eps.map((e) => e.brief).join(' | ')
ok(/海边|表格/.test(texts), '真实记忆没拿到', texts)
ok(!/【情绪】/.test(texts), '情绪条目漏进来了', texts)
ok(eps.every((e) => typeof e.brief === 'string' && e.brief.length > 0), '有条目 brief 为空')

// 没有文件时必须如实失败，不能伪造
process.env.HIPPOCAMPUS_DIR = join(home, 'nope')
const b2 = createMemoryBridge(() => null)
const r2 = await b2.refresh(6)
ok(r2?.ok === false, '没有数据时 refresh 不该假装成功', JSON.stringify(r2))
ok(b2.episodes().length === 0, '没有数据时不该有记忆条目')

rmSync(home, { recursive: true, force: true })
if (fails.length) { console.log(`\n${fails.length} 条失败`); process.exit(1) }
console.log(`PASS 人格↔记忆（磁盘退路：${eps.length} 条真实记忆，情绪条目被挡；无数据时如实失败）`)
