// 器官适配：把三个器官的真实接口翻译成海马体内部用的形状。
// 海马体内部只认这一层，不直接碰 ctx。
// 对应功能总表：E1–E15、R15–R22。

import { CONTRACT_VERSION } from './contract.js'

const get = (ctx, name) => {
  try { return ctx?.get?.(name) ?? null } catch { return null }
}

/** 皮层：extract(episode) / upsert(candidates) / handoff(id) / concepts / relations */
function adaptCortex(svc) {
  if (!svc) return null
  return {
    raw: svc,
    // 透传：包装层原来只暴露 salience，bind/extinguish 被挡在外面——海马体调不到，分数永远没归属
    bind: (input) => { try { return svc.bind?.(input) ?? null } catch { return null } },
    extinguish: (input) => { try { return svc.extinguish?.(input) ?? null } catch { return null } },
    reviewSweep: (input) => { try { return svc.reviewSweep?.(input) ?? null } catch { return null } },
    // 皮层要的是 episode 快照，字段名是 summary/text/rawTexts/role/start
    extract: (snapshot) => svc.extract(snapshot),
    // 皮层要 subject/predicate/object 的扁平候选
    upsert: (candidates) => svc.upsert(candidates),
    // 皮层明确要求返回 boolean（对象会被当 truthy 误标 retired）
    handoff: async (episodeId) => {
      try { return Boolean(await svc.handoff?.(episodeId)) } catch { return false }
    },
    concepts: (query, k) => {
      try { return svc.concepts?.(query, k) ?? null } catch { return null }
    },
    // cell → episode 的反查（皮层这版有了，E5/E8 靠它把概念命中和语义边落回事件上）
    anchorsOf: (cellId) => {
      try { return svc.anchorsOf?.(cellId) ?? null } catch { return null }
    },
    relations: (id) => {
      try { return svc.relations?.(id) ?? null } catch { return null }
    },
    contradicts: (a, b) => {
      try { return svc.contradicts?.(a, b) ?? null } catch { return null }
    },
  }
}

/** 杏仁核：salience(text, meta) → {score}；gate(id)；caution(subject) */
function adaptAmygdala(svc) {
  if (!svc) return null
  return {
    raw: svc,
    salience: (text, meta = {}) => {
      try {
        const out = svc.salience(text, meta)
        if (typeof out === 'number') return { score: clamp01(out), source: 'amygdala' }
        return {
          score: clamp01(out?.score ?? 0.3),
          source: 'amygdala',
          why: out?.why || null,
          tags: out?.tags || [],
          degraded: out?.degraded || [],
        }
      } catch {
        return null
      }
    },
    // 门控：给检索方判"这条能不能用/能不能说"
    gate: (id, opts) => {
      try { return svc.gate?.(id, opts) ?? null } catch { return null }
    },
    caution: (subject) => {
      try { return svc.caution?.(subject) ?? null } catch { return null }
    },
    // 慢路：只出建议，不改分
    refine: (input) => {
      try { return svc.refine?.(input) ?? null } catch { return null }
    },
  }
}

/** 前额叶：plan(query) / gate(text) / judge(hits) / retrieve(query) / priority */
function adaptPrefrontal(svc) {
  if (!svc) return null
  return {
    raw: svc,
    // 前额叶的 gate 返回 {keep, depth, reason}，海马体只要布尔
    shouldRemember: (text, meta = {}) => {
      try {
        const g = svc.gate(text, meta)
        if (typeof g === 'boolean') return g
        if (g && typeof g === 'object' && 'keep' in g) return Boolean(g.keep)
        return true
      } catch {
        return true
      }
    },
    // gate 的完整结果（depth 有用，留着给别的路读）
    gateDetail: (text, meta = {}) => {
      try { return svc.gate?.(text, meta) ?? null } catch { return null }
    },
    plan: (query, opts = {}) => {
      try { return svc.plan?.(query, opts) ?? null } catch { return null }
    },
    // 结果校验 / 重排
    verify: (hits, opts = {}) => {
      try { return svc.judge?.(hits, opts) ?? null } catch { return null }
    },
    // 前额叶自己会调海马体 recall，这里给个入口防重复实现
    retrieve: (query, opts = {}) => {
      try { return svc.retrieve?.(query, opts) ?? null } catch { return null }
    },
    priority: (cands, opts = {}) => {
      try { return svc.priority?.(cands, opts) ?? null } catch { return null }
    },
  }
}

function clamp01(n) {
  const v = Number(n)
  if (!Number.isFinite(v)) return 0.3
  return Math.max(0, Math.min(1, v))
}

/**
 * 探测三个器官。没接就是 null——所有调用点走 optional chaining，
 * 自动落到规则实现（单器官仍然能跑）。
 */
export function makeOrgans(ctx) {
  const cortexSvc = get(ctx, 'memory.cortex')
  const amygdalaSvc = get(ctx, 'memory.amygdala')
  const prefrontalSvc = get(ctx, 'memory.prefrontal')

  const cortex = adaptCortex(cortexSvc)
  const amygdala = adaptAmygdala(amygdalaSvc)
  const prefrontal = adaptPrefrontal(prefrontalSvc)

  return {
    cortex,
    amygdala,
    prefrontal,
    capabilities: {
      cortex: Boolean(cortexSvc),
      amygdala: Boolean(amygdalaSvc),
      prefrontal: Boolean(prefrontalSvc),
      version: CONTRACT_VERSION,
      features: {
        cortex: cortexSvc?.features || [],
      },
    },
  }
}

/** episode → 皮层要的快照。rawTexts 由调用方补。
 *  皮层会把 summary + text + rawTexts 拼成一串再抽，同一句喂两遍就会被抽成两条 cell
 *  （第八轮验收里那句住院被抽成 event/fact/relation 三条，就是这么来的）。
 *  所以：text 留空、rawTexts 去重、summary 也进去重集。 */
export function toEpisodeSnapshot(ep, rawTexts = []) {
  const summary = String(ep.summary || '').trim()
  const seen = new Set(summary ? [summary] : [])
  const uniq = []
  for (const t of rawTexts) {
    const s = String(t || '').trim()
    if (!s || seen.has(s)) continue
    seen.add(s)
    uniq.push(s)
  }
  return {
    id: ep.id,
    summary,
    text: '',
    rawTexts: uniq,
    role: ep.slots?.who || 'user',
    speaker: ep.slots?.who || 'user',
    start: ep.start,
    end: ep.end,
    entities: ep.entities || [],
    type: ep.type || '',
    salience: ep.salience,
  }
}
