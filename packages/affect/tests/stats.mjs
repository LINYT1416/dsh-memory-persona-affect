// 长期统计（给人格层的出口）：只出计数/均值，不出原话。
//   node tests/stats.mjs
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createBridge } from '../core/bridge.js'

const fails = []
const ok = (c, m) => { if (!c) fails.push(m) }

const home = mkdtempSync(join(tmpdir(), 'affstats-'))
mkdirSync(join(home, 'affect'), { recursive: true })
// 故意带 BOM、故意带一个坏时间戳：都不许把样本丢掉
const rows = [
  '{"at":"2026-11-11T20:00:00.000Z","kind":"委屈","valence":-0.5,"intensity":0.6,"depth":"deep","mood":-0.4,"id":"e1"}',
  '{"at":"2026-11-11T21:00:00.000Z","kind":"安心","valence":0.3,"intensity":0.3,"depth":"normal","mood":0.1,"id":"e2"}',
  '{"at":"看不懂的时间","kind":"厌烦","valence":-0.2,"intensity":0.2,"depth":"normal","mood":-0.1,"id":"e3"}',
  '{"at":"2026-11-11T22:00:00.000Z","kind":"x","valence":0,"intensity":0.1,"brief":"早期测试的脏数据","id":"e4"}',
].join('\n') + '\n'
writeFileSync(join(home, 'affect', 'memory-notes.jsonl'), '\uFEFF' + rows, 'utf8')

process.env.DSH_HOME = home
const b = createBridge(() => null)
const s = b.stats(3650)

ok(s.n === 3, `应统计到 3 条（坏时间戳也要算进来），实际 ${s.n}`)
ok(s.byKind['委屈'] === 1 && s.byKind['安心'] === 1 && s.byKind['厌烦'] === 1, '分类计数不对')
ok(Math.abs(s.valenceMean - (-0.133)) < 0.01, `效价均值不对：${s.valenceMean}`)
ok(Math.abs(s.deepShare - 0.333) < 0.01, `深度占比不对：${s.deepShare}`)
ok(typeof s.lastAt === 'string', 'lastAt 应是时间字符串')
ok(!JSON.stringify(s).includes('委屈被'), '统计里不该出现原话')

// 账本：id → valence（心境一致性 join 用）
const ledger = b.notesLedger()
ok(ledger.get('e1') === -0.5 && ledger.get('e2') === 0.3, `账本 join 不对：${JSON.stringify([...ledger])}`)

// 写回闸门：没有具体情绪名就不许写（否则库里有"未分类"垃圾样本）
const unnamedWrite = b.annotate({ kind: '', valence: 0, intensity: 0.3, brief: '无名' })
ok(unnamedWrite.wrote === true, '说不出名字也要记，不能整条丢掉')
ok(unnamedWrite.payload.named === false, '没名字的条目要标成 named:false')
const wrote = b.annotate({ kind: '委屈', valence: -0.4, intensity: 0.5, brief: '被顶了一下' })
ok(wrote.wrote === true && wrote.payload.named === true, '正常 kind 应写回且 named:true')

// 未命名条目不许混进 byKind，但要单独计数
const after = b.stats(3650)
ok(after.unnamed >= 1, `未命名条目应单列，实际 ${after.unnamed}`)
ok(!('有情绪' in after.byKind), '未命名不该出现在分类计数里')

// 按天分桶：人格层要看出"哪几天低落"（UTC 20:00 在东八区已算次日，这是对的）
ok(Array.isArray(s.byDay) && s.byDay.length >= 1, `byDay 应该按天分组，实际 ${JSON.stringify(s.byDay)}`)
const bucket = s.byDay.find(d => d.n === 2)
ok(bucket && Math.abs(bucket.valenceMean - (-0.1)) < 0.01, `应有一天 n=2、均值 -0.1，实际 ${JSON.stringify(bucket)}`)

// 归档脏样本：挪走但不删，原文件只留干净的
const arch = b.archiveInvalid()
ok(arch.ok === true, `归档应成功：${JSON.stringify(arch)}`)
ok(arch.moved >= 1, `应挪走至少一条脏数据，实际 ${arch.moved}`)
const afterArchive = b.stats(3650)
ok(afterArchive.invalid === 0, `归档后不该再有 invalid，实际 ${afterArchive.invalid}`)
ok(afterArchive.n >= 4, `归档后干净样本要保留，实际 ${afterArchive.n}`)

rmSync(home, { recursive: true, force: true })
delete process.env.DSH_HOME

console.log(fails.length ? `FAIL ${fails.length}:\n- ${fails.join('\n- ')}` : 'PASS 长期统计与账本 join 正常（BOM、坏时间戳都不丢样本）')
process.exit(fails.length ? 1 : 0)
