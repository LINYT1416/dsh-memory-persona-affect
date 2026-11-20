// 覆盖率：扫源码看哪些读数真的被用了，哪些还在"只出数"
import { coverage, scanWired } from '../core/coverage.js'

const fails = []
const ok = (c, m, d = '') => { if (!c) { fails.push(m + ' — ' + d); console.log('FAIL ' + m + (d ? ' — ' + d : '')) } }

// 1) 解析器本身：三种写法都要认出来
const wired = scanWired({
  a: 'v: (r) => r.ofc.warm',
  b: 'v: (r) => r.mpfc?.idealGap',
  c: 'd.brevity += 0.18 * n(mpfc.idealGap)',
  d: 'r.fused.reads.tpj.offense', // 不是六器官的直读，不算
})
ok(wired.has('ofc.warm'), '漏了 r.ofc.warm', [...wired].join(','))
ok(wired.has('mpfc.idealGap'), '漏了 n(mpfc.idealGap)', [...wired].join(','))
ok(!wired.has('fused.reads'), '把非器官引用算进来了', [...wired].join(','))

// 2) 真源码：覆盖率必须是一个有限的数，且认出常见读数
const reads = {
  str: { wanting: 0, satiation: 0, primed: 0 },
  tpj: { offense: 0, misread: 0, air: 0.5 },
  ofc: { warm: 0, shame: 0 },
  acc: { conflict: 0, error: 0 },
  mpfc: { idealGap: 0.3, discomfort: 0 },
  pcc: { crisis: 0, future: 0.8 },
}
const cov = coverage(reads)
ok(cov.total === 14, '总数不对', String(cov.total))
ok(cov.used > 0, '一条都没认出来', JSON.stringify(cov))
ok(Number.isFinite(cov.ratio) && cov.ratio > 0 && cov.ratio <= 1, 'ratio 不是 0~1', String(cov.ratio))
ok(cov.usedKeys.includes('ofc.warm'), 'ofc.warm 应该算已接线', cov.usedKeys.join(','))
ok(Array.isArray(cov.unusedKeys), 'unusedKeys 不是数组')

// 3) 空读数不能炸
const empty = coverage({})
ok(empty.total === 0 && empty.ratio === 0, '空读数处理不对', JSON.stringify(empty))

if (fails.length) process.exit(1)
console.log(`PASS 覆盖率（真实源码：${cov.used}/${cov.total} 条读数已接线，占 ${Math.round(cov.ratio * 100)}%）`)
