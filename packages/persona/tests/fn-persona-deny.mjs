// F05 否认：被问"是不是怕"才嘴硬；没问、或心里没东西，都不演
import { denyFear } from '../core/deny.js'

const fails = []
const ok = (c, m, d = '') => { if (!c) { fails.push(m + ' — ' + d); console.log('FAIL ' + m + (d ? ' — ' + d : '')) } }

// 没被问：不主动否认
const notAsked = denyFear({ tpj: { offense: 0.9 } }, '今天吃什么')
ok(notAsked.denied === false && notAsked.because === 'not-asked', '没被问不该嘴硬', JSON.stringify(notAsked))

// 被问 + 心里有东西：嘴硬
const asked = denyFear({ tpj: { offense: 0.6 } }, '你是不是怕啊')
ok(asked.denied === true && /谁怕了/.test(String(asked.line)), '被问且有情绪该嘴硬', JSON.stringify(asked))

// 被问 + 心里没东西：正常答，不否认
const calm = denyFear({}, '你是不是怕啊')
ok(calm.denied === false && calm.because === 'nothing-to-deny', '心里没事不该否认', JSON.stringify(calm))

// 心虚也算
const guilt = denyFear({ ofc: { guilt: 0.7 } }, '你是不是担心')
ok(guilt.denied === true, '心虚也该嘴硬', JSON.stringify(guilt))

// 害臊只算 0.8 权重：0.3 → 0.24 不够
const shy = denyFear({ ofc: { shame: 0.3 } }, '你怕不怕')
ok(shy.denied === false, '轻度害臊不该触发否认', JSON.stringify(shy))

// 关键：不许否认"难过"（人设写了不硬撑阳光）
for (const q of ['你是不是难过', '你心情不好吗']) {
  ok(denyFear({ ofc: { guilt: 0.9 } }, q).denied === false, '不该否认难过: ' + q, '')
}

// 脏数据
const junk = denyFear({ tpj: { offense: 'x' } }, '你是不是怕')
ok(junk.denied === false, '脏数据不该嘴硬', JSON.stringify(junk))

if (fails.length) process.exit(1)
console.log('PASS 否认（没问不演 / 有情绪才嘴硬 / 心里没事不否认 / 心虚也算 / 不否认难过 / 脏数据）')
