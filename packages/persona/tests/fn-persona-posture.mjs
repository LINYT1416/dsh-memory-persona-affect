// A03 姿态小动作：情绪不同，动作不同；没情绪就没有动作提示
import { posture } from '../core/posture.js'

const fails = []
const ok = (c, m, d = '') => { if (!c) { fails.push(m + ' — ' + d); console.log('FAIL ' + m + (d ? ' — ' + d : '')) } }

const none = posture({})
ok(none.gesture === null, '没情绪不该有动作提示', JSON.stringify(none))

const anxious = posture({ pcc: { crisis: 0.8 } })
ok(anxious.key === 'anxious' && /转笔/.test(String(anxious.gesture)), '紧张该转笔', JSON.stringify(anxious))

const shy = posture({ ofc: { shame: 0.7 } })
ok(shy.key === 'shy' && /耳机线/.test(String(shy.gesture)), '害羞该绕耳机线', JSON.stringify(shy))

const tired = posture({ str: { stop: 0.8 } })
ok(tired.key === 'tired' && /眼睛/.test(String(tired.gesture)), '累该揉眼睛', JSON.stringify(tired))

const happy = posture({ ofc: { warm: 0.8 } })
ok(happy.key === 'happy' && /拍子/.test(String(happy.gesture)), '暖该打拍子', JSON.stringify(happy))

const sad = posture({ mpfc: { esteem: 0.1 } })
ok(sad.key === 'sad' && /膝盖/.test(String(sad.gesture)), '低落该抱膝', JSON.stringify(sad))

// 优先级：危机压过害羞
const both = posture({ pcc: { crisis: 0.9 }, ofc: { shame: 0.9 } })
ok(both.key === 'anxious', '危机该优先', JSON.stringify(both))

// 五种动作互不重复
const keys = new Set([anxious.key, shy.key, tired.key, happy.key, sad.key])
ok(keys.size === 5, '五种动作应各不相同', [...keys].join(','))

// 脏数据
const junk = posture({ pcc: { crisis: 'x' }, mpfc: { esteem: NaN } })
ok(junk.gesture === null, '脏数据不该有动作', JSON.stringify(junk))

if (fails.length) process.exit(1)
console.log('PASS 姿态小动作（没情绪不演 / 五种情绪五种动作 / 危机优先 / 互不重复 / 脏数据）')
