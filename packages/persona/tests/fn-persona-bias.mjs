// B 层：进不了字面的读数必须真的改变输出（走偏置），而且不越界
import { readFileSync } from 'node:fs'
import { biasOf } from '../core/bias.js'
const fails = []
const ok = (c, m, d = '') => { if (!c) { fails.push(m + ' — ' + d); console.log('FAIL ' + m + ' — ' + d) } }

const zero = biasOf({})
ok(Object.values(zero).every((v) => v === 0), '空读盘应该全 0', JSON.stringify(zero))

const angry = biasOf({ tpj: { offense: 0.9 }, mpfc: { protecting: 0.8 } })
ok(angry.blunt > 0.2, '被冒犯+护短应该更直', JSON.stringify(angry))

const guilty = biasOf({ ofc: { guilt: 0.9, shame: 0.8 } })
ok(guilty.meme < 0, '内疚/羞应该少发表情', JSON.stringify(guilty))
ok(guilty.warmth < 0, '内疚/羞应该语气收', JSON.stringify(guilty))

const messy = biasOf({ acc: { error: 0.9, conflict: 0.9 }, str: { satiation: 0.8 } })
ok(messy.brevity > 0.2, '心里打架/腻了应该话更短', JSON.stringify(messy))

const unsure = biasOf({ tpj: { misread: 0.9 } })
ok(unsure.delayMs > 200, '拿不准应该慢半拍', JSON.stringify(unsure))

const huge = biasOf({ acc: { error: 5, conflict: 5 }, ofc: { guilt: 5 }, tpj: { misread: 5 } })
ok(huge.brevity <= 0.4 && huge.delayMs <= 1500, '越界没夹住', JSON.stringify(huge))

const eng = readFileSync(new URL('../core/engine.js', import.meta.url), 'utf8')
const code = eng.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n')
ok(/biasOf\(r\)/.test(code), 'engine 没有真的调用 biasOf')
ok(/hex\.blunt = clamp\(hex\.blunt \+ bias\.blunt/.test(code), 'engine 没把 blunt 偏置并进 hex')

if (fails.length) process.exit(1)
console.log(`PASS 偏置层（冒犯→直 +${angry.blunt.toFixed(2)}；内疚→表情 ${guilty.meme.toFixed(2)}；打架→短 +${messy.brevity.toFixed(2)}；拿不准→慢 ${unsure.delayMs}ms）`)
