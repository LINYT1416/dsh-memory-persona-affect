// 同帧互动：单个读数说不出的话，两个一起才成立；只有一个高时必须闭嘴
import { describe } from '../core/desc.js'

const fails = []
const ok = (c, m, d = '') => { if (!c) { fails.push(m + ' — ' + d); console.log('FAIL ' + m + (d ? ' — ' + d : '')) } }
const mk = (o) => describe({ reads: o }, { max: 12, prev: [] }).join(' | ')

const both = mk({ tpj: { offense: 0.8 }, acc: { conflict: 0.8 } })
ok(/被扎了一下/.test(both), '两个都高时该出互动句', both)

const onlyOffense = mk({ tpj: { offense: 0.8 } })
ok(!/被扎了一下/.test(onlyOffense), '只有冒犯高时不该出互动句', onlyOffense)

const onlyConflict = mk({ acc: { conflict: 0.8 } })
ok(!/被扎了一下/.test(onlyConflict), '只有冲突高时不该出互动句', onlyConflict)

const warmShame = mk({ ofc: { warm: 0.8, shame: 0.7 } })
ok(/暖/.test(warmShame) && /不好意思/.test(warmShame), '暖+羞该出互动句', warmShame)

const wantStop = mk({ str: { wanting: 0.9, stop: 0.8 } })
ok(/还想要/.test(wantStop), '想要+该停该出互动句', wantStop)

const none = mk({})
ok(!/被扎了一下|不好意思承认|还想要，又知道|认不出现在的自己/.test(none), '平常状态不该冒互动句', none)

if (fails.length) process.exit(1)
console.log('PASS 同帧互动（冒犯+冲突／暖+羞／想要+该停 各自成立；单高与平常都不冒）')
