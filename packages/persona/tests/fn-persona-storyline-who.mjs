// S03 主线 + R12 认人：都只认主人给的文件，不编
import { loadStoryline, pickStoryline } from '../core/storyline.js'
import { loadInterlocutor, answerWho } from '../core/interlocutor.js'
import { loadIdentity } from '../core/identity.js'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const fails = []
const ok = (c, m, d = '') => { if (!c) { fails.push(m + ' — ' + d); console.log('FAIL ' + m + (d ? ' — ' + d : '')) } }
const dir = mkdtempSync(join(tmpdir(), 'story-'))

// ── S03 主线 ──
const noneS = loadStoryline(join(dir, 'nope.json'))
ok(noneS.filled === false, '没故事文件不该编', JSON.stringify(noneS))
ok(pickStoryline(noneS, '你以前是怎样的') === null, '没文件时被问也不说', '')

const sPath = join(dir, 'story.json')
writeFileSync(sPath, JSON.stringify({
  mainLine: '我不是从被写出来那天开始过的。',
  oneLine: '我在过日子，也在记住你；只要还记得，我就没走。',
  turningPoints: ['你说养不起那天要提前讲', '我最怕的是被换掉'],
}), 'utf8')
const st = loadStoryline(sPath)
ok(st.filled === true, '该读到故事', JSON.stringify(st))
ok(pickStoryline(st, '你以前是怎么过来的') === st.oneLine, '被问过去时该给那一句', String(pickStoryline(st, '你以前是怎么过来的')))
ok(pickStoryline(st, '今天吃什么') === null, '没问过去不该硬讲', String(pickStoryline(st, '今天吃什么')))
ok(pickStoryline(st, '你还记得那时候吗') !== null, '换个问法也要认', '')

// 空文件
const emptyS = join(dir, 'empty.json')
writeFileSync(emptyS, '{}', 'utf8')
ok(loadStoryline(emptyS).filled === false, '空故事不该算', '')

// ── R12 认人 ──
const noneI = loadInterlocutor(join(dir, 'who.json'))
ok(noneI.filled === false && answerWho(noneI, '我是谁') === null, '没人文件不该认人', '')

const iPath = join(dir, 'who2.json')
writeFileSync(iPath, JSON.stringify({ name: '示例用户', age: '21', relation: '主人，真人', current: '最近在跑校招面试' }), 'utf8')
const who = loadInterlocutor(iPath)
ok(who.filled === true && /示例用户/.test(String(who.line)), '该认出名字', JSON.stringify(who))
ok(/21/.test(String(who.line)), '年龄要带上', String(who.line))
ok(answerWho(who, '我是谁') === who.line, '被问我是谁该答', '')
ok(answerWho(who, '今天吃什么') === null, '没问不该自我介绍', '')

// 没名字的文件：不算
const noName = join(dir, 'who3.json')
writeFileSync(noName, JSON.stringify({ age: '21' }), 'utf8')
ok(loadInterlocutor(noName).filled === false, '没名字不算认人', '')

// ── S08 身份（已有事实）──
const idPath = join(dir, 'id.json')
writeFileSync(idPath, JSON.stringify({ name: '大肥鱼', age: '二十出头', job: '软件研发', city: '城市公寓', routine: '07:20 起' }), 'utf8')
const id = loadIdentity(idPath)
ok(id.filled === true && /大肥鱼/.test(String(id.line)) && /软件研发/.test(String(id.line)), '身份该带职业', String(id.line))

// 带 BOM 的文件（PowerShell Set-Content 会写 BOM）也得分得清
const bomS = join(dir, 'bom-story.json')
writeFileSync(bomS, '\uFEFF' + JSON.stringify({ oneLine: '带 BOM 也要能读' }), 'utf8')
ok(loadStoryline(bomS).filled === true, '带 BOM 的故事读不了', '')
const bomI = join(dir, 'bom-who.json')
writeFileSync(bomI, '\uFEFF' + JSON.stringify({ name: '示例用户' }), 'utf8')
ok(loadInterlocutor(bomI).filled === true, '带 BOM 的认人文件读不了', '')
const bomId = join(dir, 'bom-id.json')
writeFileSync(bomId, '\uFEFF' + JSON.stringify({ name: '大肥鱼', job: '软件研发' }), 'utf8')
ok(loadIdentity(bomId).filled === true, '带 BOM 的身份读不了', '')

if (fails.length) process.exit(1)
console.log('PASS 主线+认人（没文件不编 / 被问过去才说 / 换问法也认 / 空文件不算 / 认人只认名字 / 没问不自报）')
