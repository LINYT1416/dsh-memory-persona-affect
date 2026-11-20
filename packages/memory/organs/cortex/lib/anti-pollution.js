// 抗污染（F28）：新信息先记假设，攒够独立证据再升级为事实。
// 不阻断：冲突只标记（R20），升级看证据数。
import { isNegative, similarity } from './util.js'

export const MIN_EVIDENCE = 2

// 多值谓词：不同客体不是冲突，是并列（喜欢拿铁 ≠ 讨厌美式）。
export const MULTI_VALUED = new Set(['喜欢', '讨厌', '计划', '地点', '是', '爱', '喜欢做', '不喜欢',
  '经历', '事件', '正在做', '做过', '发生', '关系',
  // 一个人可以有很多希望/职责/名字叫法，不是互斥
  '希望', '负责', '名字', '觉得', '在意', '底线'])

/** 新候选和已有条目是什么关系。 */
export function classify(candidate, existing) {
  if (!existing) return 'new'
  // 事件/经历天然可多值：裁员和住院是两件事，不是矛盾
  if (candidate.kind === 'event' || existing.kind === 'event') return 'new'
  if (candidate.object === existing.object) return 'same'
  const sameSubjectPredicate = candidate.subject === existing.subject
    && candidate.predicate === existing.predicate
  if (sameSubjectPredicate) {
    // 单值谓词（手机号/账号）不同值 = 冲突，不能被文本相似度吞掉
    if (!MULTI_VALUED.has(candidate.predicate)) return 'conflict'
    // 多值谓词：同一件事的两种说法合并，否则并列
    return similarity(candidate.text, existing.text) > 0.55 ? 'same' : 'new'
  }
  // 主体/谓词不同，但说的是同一件事 → 合并
  if (similarity(candidate.text, existing.text) > 0.55) return 'same'
  return 'new'
}

/** 两条证据之间至少要隔这么久，才算"独立验证过"（皮层低学习率）。 */
export const MIN_SPAN_MS = 12 * 60 * 60 * 1000

export function shouldUpgrade(cell, { minEvidence = MIN_EVIDENCE, minSpanMs = MIN_SPAN_MS, now = Date.now() } = {}) {
  if (cell.retracted) return false
  const n = cell.evidenceCount || 1
  if (n >= 3) return true
  if (n < minEvidence) return false
  // 只有两条证据时：必须跨过一次时间间隔，否则就是"同一场对话里说了两遍"
  const first = Number(cell.firstSeen || 0)
  const last = Number(cell.lastSeen || 0) || now
  if (!first) return true
  return last - first >= minSpanMs
}

export function upgrade(cell) {
  if (cell.state === 'fact') return false
  cell.state = 'fact'
  cell.layer = 'semantic'
  cell.evidenceFlag = false
  return true
}

/** 反话/否定检测：命中就压置信度、不升级（F24/F28 共用）。 */
export function looksLikeNegation(text) {
  return isNegative(text)
}
