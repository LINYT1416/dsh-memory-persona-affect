// 覆盖率：哪些读数真的被用上了（进了注入句子或偏置），哪些还在"只出数"。
// 做法：直接扫 desc.js / bias.js 的源码，找 r.<器官>.<键> 和 n(<器官>.<键>) 的引用。
// 不维护手写清单——手写清单一定会和代码不同步。
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))

const REF = /(?:r|reads)\s*\.\s*([a-z]+)\s*\.\s*([A-Za-z0-9_]+)/g
const REF_OPT = /(?:r|reads)\s*\.\s*([a-z]+)\s*\?\.\s*([A-Za-z0-9_]+)/g
const REF_BIAS = /\bn\s*\(\s*([a-z]+)\s*\.\s*([A-Za-z0-9_]+)\s*\)/g

export function scanWired(sources = {}) {
  const wired = new Set()
  for (const text of Object.values(sources)) {
    for (const re of [REF, REF_OPT, REF_BIAS]) {
      re.lastIndex = 0
      let m
      while ((m = re.exec(String(text || '')))) {
        const org = m[1]
        const key = m[2]
        if (!org || !key) continue
        // 只认六器官，别的（比如 fused.reads）不算
        if (!['str', 'tpj', 'ofc', 'acc', 'mpfc', 'pcc'].includes(org)) continue
        wired.add(org + '.' + key)
      }
    }
  }
  return wired
}

export function readSources() {
  const out = {}
  for (const f of ['desc.js', 'bias.js', 'relation.js']) {
    try { out[f] = readFileSync(join(here, f), 'utf8') } catch { out[f] = '' }
  }
  return out
}

// all：从引擎读数里收（键名是运行时的真实键）
export function coverage(all = {}, sources = readSources()) {
  const wired = scanWired(sources)
  const keys = []
  for (const org of ['str', 'tpj', 'ofc', 'acc', 'mpfc', 'pcc']) {
    const o = all[org]
    if (!o || typeof o !== 'object') continue
    for (const k of Object.keys(o)) keys.push(org + '.' + k)
  }
  const used = keys.filter((k) => wired.has(k))
  const unused = keys.filter((k) => !wired.has(k))
  return {
    total: keys.length,
    used: used.length,
    ratio: keys.length ? Number((used.length / keys.length).toFixed(2)) : 0,
    usedKeys: used,
    unusedKeys: unused,
  }
}
