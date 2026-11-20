// 杏仁核：分数要能绑到记忆、消退要留痕、状态要真的落盘、复核要有人跑。
import { readFileSync } from 'node:fs'
import { makeFear, extinguish, keyOf } from '../organs/amygdala/lib/fear.js'

let fail = 0
const ok = (c, m) => { if (!c) { fail++; console.log('FAIL', m) } else { console.log('  ok:', m) } }

// 1) 恐惧学习 -> 消退：强度归零，但记录不删（更正而非删除）
const state = { aversion: new Map() }
const fear = makeFear(state)
fear.learnCue('那个项目', { strength: 0.9, at: Date.now() })
const key = keyOf('那个项目', 'cue')
ok(state.aversion.get(key)?.strength === 0.9, '学到一次就该有 0.9 的强度')
extinguish(state, '那个项目', { reason: '后来知道不是我的锅' })
ok(state.aversion.get(key)?.strength === 0, '消退后强度归零')
ok(state.aversion.has(key), '消退不许删除记录（要留历史）')
ok(state.aversion.get(key)?.extinguishedAt > 0, '要记消退时间')
ok((state.corrections || []).length === 1, '要留更正记录')
ok(state.corrections[0].strengthBefore === 0.9, '更正记录要写清原强度')
ok(extinguish(state, '不存在的东西') === null, '没有关联时返回 null，不报错')

// 2) 源码护栏：这几条以前是缺的
const amy = readFileSync('E:/memory/dsh-all/organs/amygdala/index.js', 'utf8')
ok(/bind\(input = \{\}\)/.test(amy), '要有 bind（分数绑记忆）')
ok(/already-bound/.test(amy), '同一 id 不许重复绑')
ok(/extinguish\(input = \{\}\)/.test(amy), 'api 要有 extinguish')
ok(/reviewSweep\(input = \{\}\)/.test(amy), '要有 reviewSweep（闪光灯复核）')
ok(/const stateTick = setInterval/.test(amy), 'state 要定时落盘（原来那个 IIFE 只跑一次）')
ok(/saveStateSoon/.test(amy), '绑定/消退后要尽快落盘')

// 3) 海马体侧要真的调 bind（否则分数还是没有归属）
const hippo = readFileSync('E:/memory/dsh-all/organs/hippocampus/index.js', 'utf8')
ok(/memory\.amygdala/.test(hippo) && /\.bind\(/.test(hippo), '巩固后要把显著性绑到 episode id')
ok(/amygBound/.test(hippo), '绑过的要标记，避免每轮重复')

console.log(fail ? `FAIL ${fail}` : 'PASS 杏仁核（消退留痕 / bind 去重 / 复核入口 / 状态落盘 / 海马体绑定）')
process.exit(fail ? 1 : 0)
