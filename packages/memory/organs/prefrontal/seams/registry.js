// #P5-1 能力协商 / #P5-2 shadow / #P5-9 版本协商 / #P5-5 只读投影
// 一个器官一个 bool 不算数：要报"哪几项、什么粒度、多快"。
import { VERSION } from '../store/paths.js'

export const SEAMS = {
  mem: ['recall', 'episode', 'traces', 'source', 'conflicts'],
  cog: ['concepts', 'contradicts', 'search', 'summarize'],
  amy: ['salience', 'weight', 'adjust', 'state'],
  gen: ['constrain'],
  host: ['context'],
}

const GRANULARITY = {
  recall: { unit: 'hits', latency: 'T0' },
  episode: { unit: 'text', latency: 'T1' },
  traces: { unit: 'stats', latency: 'T2' },
  source: { unit: 'kind', latency: 'T0' },
  conflicts: { unit: 'pairs', latency: 'T3' },
  concepts: { unit: 'paths', latency: 'T1' },
  contradicts: { unit: 'verdict', latency: 'T3' },
  search: { unit: 'ids', latency: 'T1' },
  summarize: { unit: 'text', latency: 'T3' },
  salience: { unit: 'score', latency: 'T0' },
  weight: { unit: 'number', latency: 'T3' },
  adjust: { unit: 'write', latency: 'T3' },
  state: { unit: 'vector', latency: 'T1' },
  constrain: { unit: 'text', latency: 'T1' },
  context: { unit: 'budget', latency: 'T1' },
}

/**
 * 取服务：**只走 ctx.get(name)**。
 * 教训：`ctx.scope` / `ctx.root` 这类属性访问会被 Cordis 的 inject 守卫在 getter 阶段直接抛，
 * 连包在 try 里都能把整轮记成崩溃。皮层/杏仁核都是只调 ctx.get 就通了，这里对齐，不再兜底乱试。
 */
export function tryGet(ctx, name) {
  try {
    return ctx?.get?.(name) ?? null
  } catch {
    return null
  }
}

/** 取对象上的能力：属性访问也可能被守卫拦，逐项 try。 */
export function hasKey(obj, key) {
  if (!obj) return false
  try {
    const v = obj[key]
    return typeof v === 'function' || v === true
  } catch {
    return false
  }
}

/** 真实键名（诊断用）：接不上时先看它到底有什么。 */
export function keysOf(obj) {
  if (!obj) return []
  try {
    return Object.keys(obj)
  } catch {
    return []
  }
}

/**
 * 探测：拿到就挂，拿不到就 absent。
 * **纯函数、不缓存**：什么时候探由调用方决定（前额叶是"现探 + 500ms 节流"）。
 * 启动顺序不该决定谁瞎——所以这里绝不能把结果焊死。
 */
export function probe(ctx) {
  const get = (name) => tryGet(ctx, name)
  const organs = {
    hippocampus: get('memory.hippocampus'),
    cortex: get('memory.cortex'),
    amygdala: get('memory.amygdala'),
  }

  const capabilities = {
    v: VERSION.contract,
    mem: {},
    cog: {},
    amy: {},
    gen: {},
    host: {},
  }

  for (const key of SEAMS.mem) capabilities.mem[key] = hasKey(organs.hippocampus, key)
  for (const key of SEAMS.cog) capabilities.cog[key] = hasKey(organs.cortex, key)
  for (const key of SEAMS.amy) capabilities.amy[key] = hasKey(organs.amygdala, key)
  capabilities.gen.constrain = hasKey(get('generate'), 'constrain')
  capabilities.host.context = hasKey(get('host'), 'context')
  // 诊断：接不上时先看它到底挂了什么（只读，不参与判断）
  capabilities._keys = {
    mem: keysOf(organs.hippocampus),
    cog: keysOf(organs.cortex),
    amy: keysOf(organs.amygdala),
  }

  const count = countCapabilities(capabilities)
  return {
    organs,
    capabilities,
    // 给 judge 用的扁平表（缺一路就少一路，不会假装有）
    flat: {
      vector: Boolean(organs.hippocampus?.vectorReady),
      graph: Boolean(organs.hippocampus?.recall),
      semantic: Boolean(organs.cortex?.search),
    },
    present: count.present,
    total: count.total,
    hello: {
      version: VERSION.contract,
      organs: { hippocampus: Boolean(organs.hippocampus), cortex: Boolean(organs.cortex), amygdala: Boolean(organs.amygdala) },
      capabilities,
      granularity: GRANULARITY,
    },
  }
}

/** #P5-1 握手：一次问清四个器官在不在、能什么粒度。 */
export function hello(ctx) {
  return probe(ctx).hello
}

/** #P5-9 当前契约版本（接收方用它做版本协商）。 */
export function version() {
  return VERSION.contract
}

export function countCapabilities(cap) {  let present = 0
  let total = 0
  for (const group of ['mem', 'cog', 'amy', 'gen', 'host']) {
    for (const v of Object.values(cap[group] || {})) {
      total += 1
      if (v) present += 1
    }
  }
  return { present, total }
}

/**
 * shadow（#P5-2）：新器官先只记录不生效。
 * 返回 {apply:boolean, log:[]}——决定这一路结果要不要真的用。
 */
export function shadow(name, enabled) {
  return {
    apply: enabled === true,
    name,
    note: enabled === true ? '生效' : '只记录',
  }
}

/**
 * 版本协商（#P5-9）：未知字段忽略，缺字段走 unknown。
 * 绝不因为版本不同就崩。
 */
export function accept(envelope) {
  const v = Number(envelope?.v ?? 0)
  if (!v) return { ok: false, why: '缺版本', tri: 'absent' }
  if (v > VERSION.contract) return { ok: false, why: `版本太新 ${v}`, tri: 'unknown' }
  return { ok: true, tri: 'value', payload: envelope.payload }
}

export function explain(probeResult) {
  const miss = []
  // 以前只扫 mem/cog/amy 三组，gen/host 两条接缝断了也报 missing: []——
  // 于是 present + missing ≠ total，看着"全都接上了"，其实差两条。
  for (const group of ['mem', 'cog', 'amy', 'gen', 'host']) {
    for (const [k, v] of Object.entries(probeResult.capabilities[group] || {})) {
      if (k.startsWith('_')) continue
      if (!v) miss.push(`${group}.${k}`)
    }
  }
  return { present: probeResult.present, total: probeResult.total, missing: miss }
}
