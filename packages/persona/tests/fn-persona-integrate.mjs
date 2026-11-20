// 三器一体：心情定底色、记忆给证据、人格定怎么处理。事实 > 底线 > 心情。
import { fuse } from '../core/integrate.js'

const fails = []
const ok = (c, m, d = '') => { if (!c) { fails.push(m + ' — ' + d); console.log('FAIL ' + m + (d ? ' — ' + d : '')) } }

const sad = { emotions: [{ kind: '委屈', intensity: 0.5 }, { kind: '心痛', intensity: 0.3 }] }
const glad = { emotions: [{ kind: '开心', intensity: 0.6 }] }
const hurtMemory = [{ text: '上次说好陪我去海边，后来没去', kind: '失望' }]
const warmMemory = [{ text: '第一次一起煮饺子', kind: '开心' }]
const close = { level: 'close', sharesPrivate: true }
const stranger = { level: 'stranger', sharesPrivate: false }

// 1) 心情低 + 记忆里有同类旧事：会想起来，而不是重新难过一次
const a = fuse({ affect: sad, recall: hurtMemory, persona: { boundary: close } })
ok(a.tone === 'low', '心情低该是低的', JSON.stringify(a))
ok(a.line && /上次|海边/.test(a.line), '该把旧事带出来', String(a.line))
ok(a.because === 'mood+memory', '该记成心情+记忆联动', a.because)

// 2) 心情低但记忆里没有旧事：不许编
const b = fuse({ affect: sad, recall: [], persona: { boundary: close } })
ok(b.line === null, '没旧事就不许编', String(b.line))
ok(b.tone === 'low', '没旧事也还是低', JSON.stringify(b))

// 3) 陌生人：不翻旧账（亲近才有资格提过去）
const c = fuse({ affect: sad, recall: hurtMemory, persona: { boundary: stranger } })
ok(c.recallAllowed === false, '不熟不该翻旧账', JSON.stringify(c))
ok(c.line === null, '不熟就不提旧事', String(c.line))

// 4) 心情好 + 暖记忆：会想起暖的，但不硬翻旧账
const d = fuse({ affect: glad, recall: warmMemory, persona: { boundary: close } })
ok(d.tone === 'up', '好心情该是向上', JSON.stringify(d))
ok(d.line && /饺子/.test(d.line), '该想起暖的那件', String(d.line))

// 5) 底线破了：再高兴也不笑
const e = fuse({ affect: glad, recall: warmMemory, persona: { boundary: close, values: { bottomLine: true } } })
ok(e.tone === 'flat', '破底线时不该开心', JSON.stringify(e))
ok(e.line && /不接|换个话题/.test(e.line), '破底线时要明说，不是装作没事', String(e.line))

// 6) 心情和记忆打架：事实优先——记忆里的旧事照提，但语气仍然是低的
const f = fuse({ affect: glad, recall: hurtMemory, persona: { boundary: close } })
ok(f.tone === 'up', '心情按读数走', JSON.stringify(f))
ok(f.line === null, '高兴时不该提伤心旧事（别哪壶不开提哪壶）', String(f.line))

// 7) 空输入：不崩、不乱说
const g = fuse({})
ok(g.tone === 'flat' && g.line === null, '空输入该安静', JSON.stringify(g))

if (fails.length) process.exit(1)
console.log('PASS 三器联动（低+旧事会想起/没旧事不编/生人不翻旧账/高兴想暖事/破底线不笑/不乱提伤心事/空输入安静）')
