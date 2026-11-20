// R12 对面是谁：只从 interlocutor.json 读；没文件就不装熟人
import { readFileSync } from 'node:fs'

const WHO_Q = /(我是谁|记得我吗|你还记得我|我叫什么|知道我是谁|认得我吗)/

export function loadInterlocutor(file) {
  let raw = null
  try { raw = JSON.parse(String(readFileSync(file, 'utf8')).replace(/^\uFEFF/, '')) } catch { raw = null }
  if (!raw || typeof raw !== 'object') return { filled: false, name: '', line: null, because: 'no-file' }

  const name = typeof raw.name === 'string' ? raw.name.trim() : ''
  if (!name) return { filled: false, name: '', line: null, because: 'no-name' }

  const parts = []
  if (typeof raw.age === 'string' && raw.age.trim()) parts.push(`${raw.age.trim()} 岁`)
  if (typeof raw.relation === 'string' && raw.relation.trim()) parts.push(raw.relation.trim())
  if (typeof raw.current === 'string' && raw.current.trim()) parts.push(raw.current.trim().slice(0, 16))

  const line = `你是${name}${parts.length ? '，' + parts.join('，') : ''}`.slice(0, 34)
  return { filled: true, name, line, because: 'loaded' }
}

/** 只有被问到"我是谁"才认人；平时不念 */
export function answerWho(inter, text = '') {
  if (!inter || !inter.filled) return null
  if (!WHO_Q.test(String(text || ''))) return null
  return inter.line
}

export const WHO_QUESTION = WHO_Q
