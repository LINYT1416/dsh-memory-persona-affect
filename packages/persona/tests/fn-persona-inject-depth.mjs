// 注入条数必须真的按 max 走：读盘越满，给出的行越多（以前默认 3 行，60 多条读数大半进不去）
import { describe } from '../core/desc.js'
const fails = []
const ok = (c, m, d = '') => { if (!c) { fails.push(m + ' — ' + d); console.log('FAIL ' + m + ' — ' + d) } }
const reads = {
  str: { primed: 0.9, broken: 0.8, stop: 0.9, wanting: 0.9, satiation: 0.8, top: [{ cue: 'praise', s: 0.9, n: 9 }] },
  acc: { conflict: 0.9, error: 0.8, surprise: 0.9, compulsion: 0.8, socialClash: 0.8, commitment: 0.8 },
  ofc: { value: 0.9, warm: 0.8, guilt: 0.7, shame: 0.8, unfair: 0.8, expectGap: 0.7 },
  mpfc: { relevance: 0.9, esteem: 0.2, protecting: 0.8, idealGap: 0.8, discomfort: 0.9, blameSelf: 0.8 },
  pcc: { nostalgia: 0.8, continuity: 0.2, crisis: 0.8, anchors: [1] },
  tpj: { offense: 0.8, misread: 0.8, deception: 0.8, ingroup: 0.2, air: 0.1 },
}
const n3 = describe({ reads }, { max: 3, prev: [] }).length
const n12 = describe({ reads }, { max: 12, prev: [] }).length
const n30 = describe({ reads }, { max: 30, prev: [] })
ok(n3 === 3, 'max=3 应该正好 3 行', String(n3))
ok(n12 === 12, 'max=12 应该正好 12 行', String(n12))
ok(n30.length >= 12, 'max=30 应该比 max=12 多', String(n30.length))
const chars = n30.join('').length
const tokens = Math.round(chars / 1.6)
ok(tokens < 400, '全量注入的 token 成本失控', `${chars} 字 ≈ ${tokens} token`)
// 空读盘不能崩，也要说得出话
const empty = describe({ reads: {} }, { max: 30, prev: [] })
ok(empty.length >= 1, '空读盘应该给一句兜底', JSON.stringify(empty))
if (fails.length) process.exit(1)
console.log(`PASS 注入条数（3 行/12 行/全量 ${n30.length} 行 ≈ ${tokens} token；空盘有兜底「${empty[0]}」）`)
