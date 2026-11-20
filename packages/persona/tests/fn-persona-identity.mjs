// S08 身份：事实只从 identity.json 来；没文件、空文件都不许编
import { loadIdentity } from '../core/identity.js'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const fails = []
const ok = (c, m, d = '') => { if (!c) { fails.push(m + ' — ' + d); console.log('FAIL ' + m + (d ? ' — ' + d : '')) } }

const dir = mkdtempSync(join(tmpdir(), 'id-'))

// 没文件：什么都不说
const none = loadIdentity(join(dir, 'nope.json'))
ok(none.filled === false && none.line === null && none.because === 'no-file', '没文件不该编身份', JSON.stringify(none))

// 空文件：也不说
const emptyPath = join(dir, 'empty.json')
writeFileSync(emptyPath, '{}', 'utf8')
const empty = loadIdentity(emptyPath)
ok(empty.filled === false && empty.because === 'empty', '空文件不该编', JSON.stringify(empty))

// 坏 JSON：不崩、不编
const badPath = join(dir, 'bad.json')
writeFileSync(badPath, '{oops', 'utf8')
const bad = loadIdentity(badPath)
ok(bad.filled === false, '坏 JSON 不该崩', JSON.stringify(bad))

// 有事实：拼成一句话，且只用给到的字段
const goodPath = join(dir, 'good.json')
writeFileSync(goodPath, JSON.stringify({ name: '大肥鱼', age: '二十出头', job: '上班写代码' }), 'utf8')
const good = loadIdentity(goodPath)
ok(good.filled === true, '有事实应该 filled', JSON.stringify(good))
ok(/大肥鱼/.test(String(good.line)) && /二十出头/.test(String(good.line)), '事实要进句子', String(good.line))
ok(!/在哪|作息/.test(String(good.line)), '没给的字段不该出现', String(good.line))
ok(!/城市|地点/.test(String(good.line)), '不该自己补字段', String(good.line))

// 只有空字符串字段：算空
const blankPath = join(dir, 'blank.json')
writeFileSync(blankPath, JSON.stringify({ name: '   ', city: '' }), 'utf8')
ok(loadIdentity(blankPath).filled === false, '空字符串不算事实', JSON.stringify(loadIdentity(blankPath)))

// 多余字段：忽略
const extraPath = join(dir, 'extra.json')
writeFileSync(extraPath, JSON.stringify({ name: '大肥鱼', 我编的: '不该出现' }), 'utf8')
const extra = loadIdentity(extraPath)
ok(!/我编的/.test(String(extra.line)), '多余字段不该进句子', String(extra.line))

if (fails.length) process.exit(1)
console.log('PASS 身份（没文件不编 / 空文件不编 / 坏 JSON 不崩 / 有事实才说 / 没给的字段不补 / 空串不算 / 多余字段忽略）')
