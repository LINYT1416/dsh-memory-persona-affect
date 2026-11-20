import { describe } from '../core/desc.js'
const mk = (o) => describe({ reads: o }, { max: 12, prev: [] }).join(' | ')
const cases = [
  ['idealGap', mk({ mpfc: { idealGap: 0.95 } }), /做不到|不像想成为/],
  ['discomfort', mk({ mpfc: { discomfort: 0.95 } }), /别扭|端不住|挂不住/],
  ['error', mk({ acc: { error: 0.95 } }), /说错|说岔/],
  ['noFuture', mk({ pcc: { future: 0.05, anchorCount: 4 } }), /后面/],
  ['air', mk({ tpj: { air: 0.98 } }), /接不上话|说什么好/],
]
const plain = mk({})
const fails = []
for (const [name, text, re] of cases) if (!re.test(text)) fails.push(`${name} 没说出来：${text}`)
if (/做不到|别扭|说错|后面的事|接不上话|说什么好/.test(plain)) fails.push('默认读数不该冒出这些：' + plain)
if (fails.length) { fails.forEach((f) => console.log('FAIL ' + f)); process.exit(1) }
console.log('PASS 五条读数→一句话（idealGap/别扭/说错/后面/接不上话），默认读数一条不冒')
