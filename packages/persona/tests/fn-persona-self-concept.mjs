// S01/M02 自我概念：被反复说的那个词要真的进注入（以前只躺在 read() 里没人用）
import { describe } from '../core/desc.js'
const fails = []
const ok = (c, m, d = '') => { if (!c) { fails.push(m + ' — ' + d); console.log('FAIL ' + m + ' — ' + d) } }

const withWord = describe({ reads: { mpfc: { selfImage: { word: '厉害', n: 4 } } } }, { max: 8, prev: [] }).join(' | ')
ok(withWord.includes('厉害'), 'selfImage 没进注入', withWord)
ok(withWord.includes('认了'), '措辞不对', withWord)

const tooFew = describe({ reads: { mpfc: { selfImage: { word: '厉害', n: 1 } } } }, { max: 8, prev: [] }).join(' | ')
ok(!tooFew.includes('厉害'), '只说过一次不该定性', tooFew)

const none = describe({ reads: {} }, { max: 8, prev: [] })
ok(none.length >= 1, '空读盘要兜底')

if (fails.length) process.exit(1)
console.log(`PASS S01 自我概念进注入（「${withWord.split(' | ').filter((l) => l.includes('厉害'))[0]}」；只说过一次不定性；空盘兜底）`)
