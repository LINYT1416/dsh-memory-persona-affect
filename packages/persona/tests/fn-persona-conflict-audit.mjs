// S10 冲突自检：读数互相打架时进队列，不硬解释
import { detectConflicts, createConflictLog } from '../core/audit.js'
import fs from 'node:fs'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const fails = []
const ok = (c, m, d = '') => { if (!c) { fails.push(m + ' — ' + d); console.log('FAIL ' + m + (d ? ' — ' + d : '')) } }

// 1) 检测：两条都高才算冲突
const both = detectConflicts({ ofc: { warm: 0.8 }, tpj: { offense: 0.8 } })
ok(both.length === 1 && both[0].id === 'warm-vs-offense', '两个都高时该报冲突', JSON.stringify(both))
const onlyWarm = detectConflicts({ ofc: { warm: 0.8 }, tpj: { offense: 0.1 } })
ok(onlyWarm.length === 0, '只有一个高不该报', JSON.stringify(onlyWarm))
const none = detectConflicts({})
ok(none.length === 0, '空读数不该报', JSON.stringify(none))

// 2) 落盘 + 去重：10 分钟内同一组合只记一次
const dir = mkdtempSync(join(tmpdir(), 'audit-'))
const file = join(dir, 'conflicts.json')
const log = createConflictLog(file)
const t0 = 1_800_000_000_000
const first = log.note(both, t0)
ok(first.length === 1, '第一次应该记一条', JSON.stringify(first))
const again = log.note(both, t0 + 60_000)
ok(again.length === 0, '10 分钟内不该重复记', JSON.stringify(again))
const later = log.note(both, t0 + 11 * 60_000)
ok(later.length === 1, '过了 10 分钟应该再记', JSON.stringify(later))
ok(log.count() === 2, '总数应该是 2，实际 ' + log.count())
ok(fs.existsSync(file), '队列文件没写出来')

// 3) 坏文件不影响
fs.writeFileSync(file, '不是 json', 'utf8')
ok(log.count() === 0, '坏文件应该当成空队列')

rmSync(dir, { recursive: true, force: true })
if (fails.length) process.exit(1)
console.log('PASS 冲突自检（双高才报 / 10 分钟去重 / 落盘 / 坏文件回空）')
