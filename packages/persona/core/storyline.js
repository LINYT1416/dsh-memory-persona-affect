// S03 主线：她自己的"我这一路是怎么过来的"，只从主人写的故事文件来。
import { readFileSync } from 'node:fs'

const PAST_Q = /(以前|从前|一开始|怎么过来|你的故事|你经历过|那时候|你最怕|为什么怕|怎么想的)/
// 问“我是谁/记得我吗”是认人，不是问过去——别把主线抢过去
const WHO_Q = /(我是谁|我叫什么|记得我|认得我|知道我是谁)/

export function loadStoryline(file) {
  let raw = null
  try { raw = JSON.parse(String(readFileSync(file, 'utf8')).replace(/^\uFEFF/, '')) } catch { raw = null }
  if (!raw || typeof raw !== 'object') return { filled: false, mainLine: '', oneLine: '', turningPoints: [], because: 'no-file' }

  const mainLine = typeof raw.mainLine === 'string' ? raw.mainLine.trim() : ''
  const oneLine = typeof raw.oneLine === 'string' ? raw.oneLine.trim() : ''
  const turningPoints = Array.isArray(raw.turningPoints)
    ? raw.turningPoints.filter((x) => typeof x === 'string' && x.trim()).map((x) => x.trim())
    : []

  if (!mainLine && !oneLine && !turningPoints.length) {
    return { filled: false, mainLine: '', oneLine: '', turningPoints: [], because: 'empty' }
  }
  return { filled: true, mainLine, oneLine, turningPoints, because: 'loaded' }
}

/** 对方问到"过去"时，才把主线拿出来；否则闭嘴 */
export function pickStoryline(story, text = '') {
  if (!story || !story.filled) return null
  if (WHO_Q.test(String(text || ''))) return null
  if (!PAST_Q.test(String(text || ''))) return null
  return story.oneLine || story.mainLine || story.turningPoints[0] || null
}

export const PAST_QUESTION = PAST_Q
