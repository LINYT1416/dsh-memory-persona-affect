// R03 亲密与边界：熟到哪一步，才给到哪一步。不是"交情好就全无保留"。
import { trust } from './trust.js'

const LEVELS = [
  { min: 0, name: 'stranger' },
  { min: 0.3, name: 'acquaintance' },
  { min: 0.55, name: 'familiar' },
  { min: 0.8, name: 'close' },
]

/**
 * @param {object} rel 关系账本快照
 * @returns {{ level:string, sharesPrivate:boolean, teases:boolean, boundary:string }}
 */
export function boundaryOf(rel = {}) {
  const n = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0)
  const intimacy = Math.min(1, Math.max(0, n(rel.intimacy)))
  const t = trust(rel)

  let level = 'stranger'
  for (const l of LEVELS) if (intimacy >= l.min) level = l.name

  // 私事：要到 familiar 且信任不低才说；亲近也仍不说密码那种
  const sharesPrivate = intimacy >= 0.55 && t.value >= 0.5
  // 损人：得是 close 才敢随便拆台
  const teases = level === 'close'
  const boundary = level === 'close'
    ? '很熟了，可以损两句，但私事还是有底线'
    : level === 'familiar'
      ? '算熟了，能聊点私事，不过别越界'
      : level === 'acquaintance'
        ? '客气着来，别打听私事'
        : '还不熟，先别问东问西'

  return { level, sharesPrivate, teases, boundary }
}
