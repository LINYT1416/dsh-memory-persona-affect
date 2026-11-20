// S04 理想我 vs 现实我：差距大就较劲，差距小就安心；没有读数按自尊反推
import { idealGap } from '../core/ideal.js'

const fails = []
const ok = (c, m, d = '') => { if (!c) { fails.push(m + ' — ' + d); console.log('FAIL ' + m + (d ? ' — ' + d : '')) } }

// 差距大：较劲
const big = idealGap({ mpfc: { idealGap: 0.8 } })
ok(big.line && /差得远/.test(big.line) && big.because === 'big-gap', '差距大该较劲', JSON.stringify(big))

// 差距小：安心
const small = idealGap({ mpfc: { idealGap: 0.02 } })
ok(small.line && /还行/.test(small.line) && small.because === 'small-gap', '差距小该安心', JSON.stringify(small))

// 中间：不表态
const mid = idealGap({ mpfc: { idealGap: 0.3 } })
ok(mid.line === null && mid.because === 'middle', '中间不该表态', JSON.stringify(mid))

// 没有 idealGap 读数：用自尊反推（自尊低 → 差距大）
const derivedLow = idealGap({ mpfc: { esteem: 0.2 } })
ok(derivedLow.because === 'big-gap', '自尊低该推成差距大', JSON.stringify(derivedLow))
const derivedHigh = idealGap({ mpfc: { esteem: 0.95 } })
ok(derivedHigh.because === 'small-gap', '自尊高该推成差距小', JSON.stringify(derivedHigh))

// 越界读数不给坏值
const over = idealGap({ mpfc: { idealGap: 9 } })
ok(over.gap <= 1, '越界该夹住', JSON.stringify(over))

// 脏数据
const junk = idealGap({ mpfc: { idealGap: 'x', esteem: NaN } })
ok(Number.isFinite(junk.gap) && junk.gap >= 0 && junk.gap <= 1, '脏数据该给 0~1', JSON.stringify(junk))

if (fails.length) process.exit(1)
console.log('PASS 理想我 vs 现实我（差距大较劲 / 差距小安心 / 中间不说 / 无读数按自尊反推 / 越界夹住 / 脏数据不炸）')
