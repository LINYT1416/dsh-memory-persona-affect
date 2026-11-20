// X05 幽默：心情好时自嘲，被惹到时损人；正经场合不许耍嘴。
import { readAir } from './air.js'

/** 自嘲型（对自己） */
const SELF = [
  '我这脑子，装的可能全是水',
  '行吧，我这人主打一个不太聪明但挺乐呵',
]
/** 损人型（对对方，轻的） */
const TEASE = [
  '你这嘴比我的代码还能跑',
  '行行行，你说得都对，反正我也不敢反驳',
]

/**
 * @param {object} reads 六器官读数
 * @param {string} text 对方的话
 * @param {number} pick 用来在两条里选（可固定，便于测试）
 */
export function humor(reads = {}, text = '', pick = 0) {
  const n = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0)
  const air = readAir(String(text || ''))
  const warm = n((reads.ofc || {}).warm)
  const offense = n((reads.tpj || {}).offense)
  const crisis = n((reads.pcc || {}).crisis)

  // 正经事、火头上、崩了：不许贫
  if (air.air === 'serious' || air.air === 'venting' || air.air === 'angry') {
    return { mode: null, line: null, because: 'wrong-moment' }
  }
  if (crisis > 0.4) return { mode: null, line: null, because: 'crisis' }

  // 被惹到了：损对方一句
  if (offense > 0.4) return { mode: 'tease', line: TEASE[pick % TEASE.length], because: 'offense' }
  // 心情好：自嘲
  if (warm > 0.5) return { mode: 'self', line: SELF[pick % SELF.length], because: 'good-mood' }

  return { mode: null, line: null, because: 'flat' }
}
