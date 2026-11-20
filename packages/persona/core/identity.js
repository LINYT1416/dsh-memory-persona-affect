// S08 身份：她是谁的"事实"，只从主人给的 identity.json 来——绝不由代码编。
// 没这个文件时，一切为 null，注入里一个字都不提。

import { readFileSync } from 'node:fs'

const FIELDS = [
  ['name', '名字'],
  ['age', '年龄'],
  ['job', '做什么'],
  ['city', '在哪'],
  ['routine', '作息'],
]

/**
 * @param {string} file identity.json 路径
 * @returns {{ filled:boolean, facts:object, line:string|null, because:string }}
 */
export function loadIdentity(file) {
  let raw = null
  try { raw = JSON.parse(String(readFileSync(file, 'utf8')).replace(/^\uFEFF/, '')) } catch { raw = null }
  if (!raw || typeof raw !== 'object') return { filled: false, facts: {}, line: null, because: 'no-file' }

  const facts = {}
  for (const [k] of FIELDS) {
    const v = raw[k]
    if (typeof v === 'string' && v.trim()) facts[k] = v.trim()
  }
  if (!Object.keys(facts).length) return { filled: false, facts: {}, line: null, because: 'empty' }

  const parts = FIELDS.filter(([k]) => facts[k]).map(([k, label]) => `${label}：${facts[k]}`)
  return { filled: true, facts, line: `她是这样的——${parts.join('；')}`, because: 'loaded' }
}

export const IDENTITY_FIELDS = FIELDS
