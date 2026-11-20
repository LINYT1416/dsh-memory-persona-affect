// describe 的契约：缺器官、缺键、给空对象——都不许抛错、不许说出"看不见未来"这种假话
import { describe } from '../core/desc.js'
const fails = []
const run = (label, reads) => {
  let out
  try { out = describe({ reads }, { max: 10, prev: [] }) } catch (e) { fails.push(label + ' 抛错: ' + e.message); return }
  if (!Array.isArray(out) || !out.length) { fails.push(label + ' 没说出任何话'); return }
  if (out.some((l) => typeof l !== 'string' || !l.trim())) fails.push(label + ' 有空的/非字符串的行')
  if (out.some((l) => /undefined|NaN/.test(l))) fails.push(label + ' 行里出现 undefined/NaN: ' + out.join(' | '))
  if (/后面的事一片糊|不敢想/.test(out.join(''))) fails.push(label + ' 缺读数却说"看不见未来": ' + out.join(' | '))
}
run('空读', {})
run('半读', { str: { wanting: 0.5 }, mpfc: { idealGap: 0.4 } })
run('只有 pcc', { pcc: { crisis: 0.2 } })
run('读数全是 0', { str: {}, tpj: {}, ofc: {}, acc: {}, mpfc: {}, pcc: {} })
if (fails.length) { fails.forEach((f) => console.log('FAIL ' + f)); process.exit(1) }
console.log('PASS describe 缺读数兜底（空读/半读/只有 pcc/全 0，四种都不抛错、不编 future、无 undefined）')
