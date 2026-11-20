// dsh-all —— 四器官记忆系统合并版（外壳）
//
// 四个器官各自的内核原封不动放在 organs/ 下，这里只做四件事：
//   1. 按依赖顺序启动它们（先底层，后控制）
//   2. 读 config.json 决定谁往 system prompt 里注入
//   3. 统一收拢清理函数
//   4. 统一声明 inject（子模块自己的 inject 不生效，必须在这里声明）
//
// 注入开关（config.json 的 inject 段）：
//   true  = 该器官会往 system prompt 写内容（AI 主动想起来）
//   false = 不写，器官退化成纯资料库（工具照常可用）
//   读不到 config.json 时一律按 true 处理 —— 等于改动前的行为，是最安全的回滚状态。
//
// 数据目录不变：各器官仍然写 ~/.dsh/{hippocampus,cortex,prefrontal,amygdala}
// 工具名不变：hippocampus_* / cortex_* / prefrontal_* / amygdala_*

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import * as cortex from './organs/cortex/index.js'
import * as amygdala from './organs/amygdala/index.js'
import * as prefrontal from './organs/prefrontal/index.js'
import * as hippocampus from './organs/hippocampus/index.js'
import { appendFileSync, mkdirSync } from 'node:fs'

export const name = 'dsh-all'
export const version = '0.2.0'
export const inject = ['tools', 'webServer', 'agents', 'sessions']

const HERE = dirname(fileURLToPath(import.meta.url))

const ORGANS = [
  ['cortex', cortex],
  ['amygdala', amygdala],
  ['prefrontal', prefrontal],
  ['hippocampus', hippocampus],
]

/** 读注入开关；任何异常都退回"全开"。 */
function loadInject() {
  const fallback = { hippocampus: true, cortex: true, prefrontal: true, amygdala: true }
  try {
    const raw = readFileSync(join(HERE, 'config.json'), 'utf8')
    const parsed = JSON.parse(raw)
    const inject = parsed?.inject
    if (!inject || typeof inject !== 'object') return fallback
    const out = { ...fallback }
    for (const key of Object.keys(out)) {
      if (typeof inject[key] === 'boolean') out[key] = inject[key]
    }
    return out
  } catch {
    return fallback
  }
}

import { memoryPage, buildMemoryData } from './web/memory-page.js'

export function apply(ctx) {
  const injectConfig = loadInject()
  // 内核通过这个全局读开关；不在就需要它的时候读不到，按 true 处理
  globalThis.__DSH_ALL_INJECT__ = injectConfig

  const disposers = []
  const loaded = []
  const failed = []

  for (const [id, mod] of ORGANS) {
    try {
      if (typeof mod.apply !== 'function') {
        failed.push({ id, error: 'no apply export' })
        continue
      }
      const dispose = mod.apply(ctx)
      if (typeof dispose === 'function') disposers.push(dispose)
      loaded.push(id)
    } catch (error) {
      // 一个器官起不来不能拖垮其他三个
      failed.push({ id, error: String(error?.message || error) })
      try {
        const dir = process.env.HIPPOCAMPUS_DIR || 'C:/Users/64091/.dsh/hippocampus'
        mkdirSync(dir, { recursive: true })
        appendFileSync(dir + '/_brain.log', JSON.stringify({
          at: Date.now(), organ: id, error: String(error?.message || error), stack: String(error?.stack || '').split('\n').slice(0, 4).join(' | '),
        }) + '\n')
      } catch { /* 写不进去就算了 */ }
    }
  }

  try {
    ctx.provide?.('memory.brain', {
      version,
      organs: loaded,
      failed,
      inject: injectConfig,
      status: () => ({
        version,
        organs: loaded,
        failed,
        inject: injectConfig,
        at: Date.now(),
      }),
    })
  } catch { /* 老版本没有 provide */ }

  // ── 记忆仪表页（只读）────────────────────────────────────
  const svc = (id) => { try { return ctx.get?.(id) ?? null } catch { return null } }
  const json = (res, obj) => { try { res.statusCode = 200; res.setHeader('content-type', 'application/json; charset=utf-8'); res.end(JSON.stringify(obj)) } catch { /* 连接断了 */ } }
  try {
    ctx.webServer?.register?.({
      path: '/memory',
      handler: async (req, res) => { res.setHeader('content-type', 'text/html; charset=utf-8'); res.end(memoryPage()) },
    })
    ctx.webServer?.register?.({
      path: '/memory/data',
      handler: async (req, res) => {
        const data = await buildMemoryData({
          prefrontal: svc('memory.prefrontal'),
          hippocampus: svc('memory.hippocampus'),
          cortex: svc('memory.cortex'),
        })
        json(res, data)
      },
    })
  } catch { /* 没有 webServer */ }

  return () => {
    for (const dispose of disposers.reverse()) {
      try { dispose() } catch { /* 卸载出错不阻塞其他 */ }
    }
  }
}
