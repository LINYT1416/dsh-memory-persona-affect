// 向量层：能拿真向量就用，拿不到就返回 null（绝不拿哈希向量冒充）。
// 对应功能总表：L3-1、缺向量分层方案（L0/L1/L2）、L2-2 可重建。

import { readJson, writeJsonAtomic, FILES } from './store.js'
import { sha16 } from './util.js'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const MODEL = process.env.DSH_EMBED_MODEL || 'Xenova/bge-small-zh-v1.5'
const REMOTE_URL = process.env.DSH_EMBED_URL || ''
const REMOTE_KEY = process.env.DSH_EMBED_KEY || ''
// 直连 huggingface.co 在国内基本拉不动，默认走镜像；要换就设 DSH_HF_MIRROR
const HF_MIRROR = process.env.DSH_HF_MIRROR || 'https://hf-mirror.com'
const MODEL_CACHE = process.env.DSH_MODEL_CACHE || join(homedir(), '.dsh', 'hippocampus', 'models')

let cache = null        // { model, dim, vecs: { hash: number[] } }
let localPipe = null
let localFailed = false
let dirty = false

async function loadCache() {
  if (cache) return cache
  cache = (await readJson(FILES.vectors, null)) || { model: MODEL, dim: 0, vecs: {} }
  return cache
}

async function flush() {
  if (!dirty) return
  try {
    await writeJsonAtomic(FILES.vectors, cache)
    dirty = false
  } catch { /* 写不进去下次再说 */ }
}

async function embedRemote(text) {
  if (!REMOTE_URL) return null
  try {
    const res = await fetch(REMOTE_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(REMOTE_KEY ? { authorization: `Bearer ${REMOTE_KEY}` } : {}),
      },
      body: JSON.stringify({ model: MODEL, input: text }),
      signal: AbortSignal.timeout(8000),
    })
    if (!res.ok) return null
    const data = await res.json()
    const vec = data?.data?.[0]?.embedding || data?.embedding || null
    return Array.isArray(vec) ? vec : null
  } catch {
    return null
  }
}

async function loadTransformers() {
  // 1) 插件自己的 node_modules（正式安装路径）
  // 2) DSH_EMBED_LIB 指定的绝对路径（离线/共享依赖时用）
  // 3) 老 hippocampus 安装里的那份（这台机器实际存在的唯一一份）
  // 找不到就抛，让上层退化成 BM25——宁可不检索，也不拿哈希向量冒充。
  const viaFile = (p) => pathToFileURL(p).href
  const candidates = []
  if (process.env.DSH_EMBED_LIB) candidates.push(viaFile(process.env.DSH_EMBED_LIB))
  candidates.push('@xenova/transformers')
  candidates.push(viaFile('E:/memory/hippocampus/node_modules/@xenova/transformers/src/transformers.js'))

  let lastErr = null
  for (const spec of candidates) {
    try {
      return await import(spec)
    } catch (error) {
      lastErr = error
    }
  }
  throw lastErr || new Error('no transformers')
}

async function embedLocal(text) {
  if (localFailed) return null
  try {
    if (!localPipe) {
      const mod = await loadTransformers()
      // 模型从镜像拉，缓存落 E 盘同级目录，别塞 C 盘
      try {
        mod.env.remoteHost = HF_MIRROR
        mod.env.cacheDir = MODEL_CACHE
        mod.env.allowRemoteModels = true
      } catch { /* 老版本没有 env 就算了 */ }
      localPipe = await mod.pipeline('feature-extraction', MODEL, { quantized: true })
    }
    const out = await localPipe(String(text).slice(0, 512), { pooling: 'mean', normalize: true })
    return Array.from(out.data)
  } catch (error) {
    // 第一次失败要留个记号，别每条都重试一遍下载
    localFailed = true
    throw error
  }
}

/** 拿一条文本的真向量；拿不到返回 null。 */
export async function embed(text) {
  const c = await loadCache()
  const key = sha16(`${c.model}|${String(text).slice(0, 512)}`)
  const hit = c.vecs[key]
  if (Array.isArray(hit) && hit.length) return hit
  const vec = (await embedRemote(text)) || (await embedLocal(text))
  if (!vec || !vec.length) return null
  c.dim = vec.length
  c.vecs[key] = vec
  dirty = true
  // 攒一批再落盘
  if (Object.keys(c.vecs).length % 20 === 0) await flush()
  return vec
}

export function cosine(a, b) {
  if (!a || !b || a.length !== b.length) return 0
  let d = 0
  let na = 0
  let nb = 0
  for (let i = 0; i < a.length; i++) {
    d += a[i] * b[i]
    na += a[i] * a[i]
    nb += b[i] * b[i]
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb)
  return denom ? d / denom : 0
}

/** 覆盖率：向量层现在到什么程度（前端显示用）。 */
export async function coverage(total) {
  const c = await loadCache()
  const have = Object.keys(c.vecs).length
  return { model: c.model, dim: c.dim, have, total, ratio: total > 0 ? Math.min(1, have / total) : 0 }
}

export async function flushVectors() {
  await flush()
}
