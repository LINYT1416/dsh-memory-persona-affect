// F03 投射：自己心里有火，却先问对方"你是不是生气了"。
// 判据：必须是"她有情绪 + 对方没有明确情绪"才成立；对方真生气了就不叫投射。
import { readAir } from './air.js'

/**
 * @param {object} reads 六器官读数
 * @param {string} text 对方刚说的话
 * @returns {{ projected:boolean, line:string|null, because:string|null }}
 */
export function project(reads = {}, text = '') {
  const n = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0)
  const tpj = reads.tpj || {}
  const ofc = reads.ofc || {}

  const air = readAir(String(text || ''))
  // 对方已经明确在火头上：那是真的生气，不是投射
  if (air.air === 'angry') return { projected: false, line: null, because: 'other-really-angry' }

  // 她被冒犯：把自己的不舒服放到对方身上
  if (n(tpj.offense) > 0.5) {
    return { projected: true, line: '你是不是有点生气啊', because: 'own-offense' }
  }

  // 她自己心虚：觉得对方在怪她
  if (n(ofc.guilt) > 0.5) {
    return { projected: true, line: '你是不是在怪我', because: 'own-guilt' }
  }

  return { projected: false, line: null, because: null }
}
