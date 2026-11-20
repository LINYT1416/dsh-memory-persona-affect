// 闪光灯复核判据（4.5）：确信度 ≠ 准确度。
// 定稿口径：confidence ≥ 0.85 且 salience ≥ 0.5 才进复核队列。
import { isReviewCandidate, REVIEW_CONF_MIN, REVIEW_SAL_MIN } from '../organs/amygdala/lib/review.js'

let fail = 0
const ok = (c, m) => { if (!c) { fail++; console.log('FAIL', m) } else { console.log('  ok:', m) } }

ok(REVIEW_CONF_MIN === 0.85, 'confidence 门槛是 0.85')
ok(REVIEW_SAL_MIN === 0.5, 'salience 门槛是 0.5')

ok(isReviewCandidate({ confidence: 0.9, score: 0.6 }), '两样都够 → 进复核')
ok(!isReviewCandidate({ confidence: 0.9, score: 0.4 }), '确信高但不醒目 → 不进（避免漏判成"记得清=重要"）')
ok(!isReviewCandidate({ confidence: 0.6, score: 0.9 }), '醒目但没把握 → 不进（避免把"抓眼球"当"记得清"）')
ok(!isReviewCandidate({}), '空对象不进')
ok(!isReviewCandidate({ confidence: 'x', score: 'y' }), '非数字不进，不抛错')
ok(isReviewCandidate({ confidence: 0.85, score: 0.5 }), '恰好等于门槛 → 进（边界包含）')
ok(isReviewCandidate({ confidence: 1, score: 1 }), '满分进')

console.log(fail ? `FAIL ${fail}` : 'PASS 复核判据（confidence≥0.85 且 salience≥0.5，边界包含）')
process.exit(fail ? 1 : 0)
