// 巩固（F14–F19）：重放一批 episode，抽候选、累计证据、升级/冲突、建图、审计、锁存。
// 单器官阶段：只读海马体，不写它；所有加工都在皮层这一侧。
import { cellKey } from './schema.js'
import { extractEpisode, toCell } from './extract.js'
import { addSupport } from './evidence.js'
import { recompute } from './confidence.js'
import { classify, shouldUpgrade, upgrade } from './anti-pollution.js'
import { record } from './conflicts.js'
import { detect as detectBias, apply as applyBias } from './schema-bias.js'
import { matchScore } from './schema-boost.js'
import { attach, temporal, cellNode } from './schema-graph.js'
import { findPatterns, findRules } from './commonality.js'
import { hasResultSignal, rankCauses } from './causality.js'
import { refreshTier, archiveCold } from './hot-cold.js'
import { applyWeights } from './learning.js'
import { snapshot } from './version.js'
import { commit } from './latch.js'
import { log } from './audit.js'
import { findInterference } from './overlap.js'
import { writeMeta } from './store.js'
import { takeBatch, BATCH, DEEP_BATCH } from './batch.js'
import { splitByWindow } from './coupling.js'
import { applyRetirement } from './retirement.js'
import { levelOf, linkLevels } from './levels.js'
import { stdpDelta } from './stdp.js'
import { counts as traceCounts, recallBoost } from './traces.js'

const WINDOW_MS = 90 * 60 * 1000

export function makeConsolidator({ store, adapters, meta }) {
  if (!meta.distilled) meta.distilled = {}

  function pending(episodes) {
    return episodes.filter((ep) => meta.distilled[ep.id] !== (ep.version || 1))
  }

  async function run({ episodes = [], mode = 'shallow', now = Date.now(), dryRun = false } = {}) {
    const batch = takeBatch(pending(episodes), mode)
    if (!batch.length) return { processed: 0, mode, skipped: 'nothing-new' }

    if (!dryRun) await snapshot(store, meta)

    let processed = 0
    let promoted = 0
    let conflicted = 0
    let lastAt = 0
    const promotedIds = []
    const conflictIds = []
    const persist = !dryRun
    let prevEp = null

    // R18：批必须落在同一个 up 窗口内，跨窗口拆组处理
    const groups = splitByWindow(batch, WINDOW_MS)
    for (const group of groups) {
      for (const ep of group) {
        const at = Number(ep.start || ep.end || now)
        const candidates = extractEpisode(ep, { at })

        // F37：显著性从杏仁核来；不在就走规则分
        const sal = await adapters.amygdala.salience(ep.summary || '')
        const salScore = typeof sal === 'number' ? sal : Number(sal?.score ?? 0.5)
        // F23：已有同类图式 → 新建/升级门槛降低（R5）
        const existingPatterns = store.allCells().filter((c) => c.tags?.includes('pattern'))
        const schemaHitBase = existingPatterns.length
          ? Math.max(...existingPatterns.map((p) => matchScore({ text: ep.summary || '' }, [p])))
          : 0

        for (const cand of candidates) {
          const fresh = toCell(cand)
          // F36：反话/气话判定，前额叶不在就走词表桩
          const truth = await adapters.prefrontal.truthfulness(cand.text)
          const truthScore = typeof truth === 'number' ? truth : Number(truth?.score ?? 0.65)
          // F23：同谓词已有图式 → 算命中
          const schemaHit = schemaHitBase >= 0.3 || existingPatterns.some((p) => p.predicate === cand.predicate)

          fresh.salience = salScore
          if (truthScore < 0.35) {
            fresh.confidence = Math.min(fresh.confidence, 0.3)
            fresh.evidenceFlag = true
          }

          const exact = store.find(cellKey(fresh))
          const peer = exact || store.findByPredicate(cand.subject, cand.predicate)
          const kind = classify(cand, peer)
          if (process.env.DBG_CONSOLIDATE) console.error('[dbg]', JSON.stringify({ subject: cand.subject, predicate: cand.predicate, object: cand.object, peer: peer ? { s: peer.subject, p: peer.predicate, o: peer.object } : null, kind }))

          if (peer && kind === 'same') {
            const added = addSupport(peer, ep.id)
            peer.lastSeen = Math.max(peer.lastSeen || 0, at)
            peer.salience = Math.max(peer.salience || 0, salScore)
            peer.confidence = recompute(peer)
            if (added && shouldUpgrade(peer, { minEvidence: schemaHit ? 1 : 2 }) && upgrade(peer)) {
              promoted += 1
              promotedIds.push(peer.id)
            }
            store.put(peer, { persist })
            attach(store, peer)
            store.features.addCoactivation(peer.featureIds)
          } else if (peer && kind === 'conflict') {
            // 事件不互斥；主体不同也不互斥（自己裁员 vs 爸爸住院）
            const notConflict = fresh.kind === 'event' || peer.kind === 'event'
              || fresh.subject !== peer.subject
            if (notConflict) {
              store.put(fresh, { persist })
              attach(store, fresh)
              store.features.addCoactivation(fresh.featureIds)
            } else {
              await record(store, peer, fresh, 'value-mismatch')
              conflicted += 1
              conflictIds.push(fresh.id)
              let bias = { bias: false }
              if (peer.state === 'fact') bias = detectBias(cand, peer)
              applyBias(fresh, bias)
              fresh.evidenceFlag = true
              fresh.confidence = Math.min(fresh.confidence, 0.4)
              store.put(fresh, { persist })
              attach(store, fresh)
              store.features.addCoactivation(fresh.featureIds)
            }
          } else {
            const factPeer = store.findByPredicate(cand.subject, cand.predicate)
            if (factPeer && factPeer.state === 'fact') applyBias(fresh, detectBias(cand, factPeer))
            // 图式命中 + 反话判定都没问题，可以直接当事实
            if (schemaHit && truthScore >= 0.35) {
              fresh.state = 'fact'
              fresh.layer = 'semantic'
              promoted += 1
              promotedIds.push(fresh.id)
            }
            store.put(fresh, { persist })
            attach(store, fresh)
            store.features.addCoactivation(fresh.featureIds)
          }
        }

        // 序列：相邻 episode 一条时间边，权重由 STDP 给（F12）
        if (prevEp) {
          const w = stdpDelta(Number(prevEp.start || 0), at)
          temporal(store, `ep_${prevEp.id}`, `ep_${ep.id}`, w)
        }
        // 因果：有结果信号才给因果候选，否则只共现（F30）
        if (hasResultSignal(ep.summary || '')) {
          const causes = rankCauses(store.allCells().map((c) => ({ id: c.id, at: c.lastSeen, text: c.text })), at)
          for (const c of causes.slice(0, 3)) store.addEdge(`c_${c.id}`, `ep_${ep.id}`, 'causal', 1)
        }

        // 退场：巩固过一轮的条目 held → shadowed（F34）
        for (const c of store.allCells()) {
          if ((c.supportIds || []).includes(ep.id)) applyRetirement(c, { handoffOk: false })
        }

        prevEp = ep
        meta.distilled[ep.id] = ep.version || 1
        processed += 1
        lastAt = Math.max(lastAt, at)
      }
    }

    // 共性提取（F21）：同谓词 ≥3 个不同客体 → 一条规律
    const patterns = findPatterns(store.allCells(), { min: 3 })
    let newPatterns = 0
    for (const p of patterns) {
      const exists = store.allCells().find((c) => c.tags?.includes('pattern') && c.predicate === p.predicate && c.object === p.object)
      if (exists) continue
      const cell = toCell({ ...p, tags: ['pattern'] })
      cell.kind = 'concept'
      cell.state = 'fact'
      cell.layer = 'semantic'
      store.put(cell, { persist })
      attach(store, cell)
      newPatterns += 1
    }

    // 规律层：跨天反复出现才升（稳定 id，重算不新增）
    let newRules = 0
    for (const r of findRules(store.allCells())) {
      if (store.get(r.id)) continue
      const cell = toCell({ ...r, tags: ['pattern', 'rule'] })
      cell.id = r.id
      cell.kind = 'concept'
      cell.level = 'rule'
      cell.state = 'fact'
      cell.layer = 'semantic'
      cell.supports = r.supports
      store.put(cell, { persist })
      attach(store, cell)
      newRules += 1
    }

    // 层级与双向支撑（F08）
    const cells = store.allCells()
    for (const c of cells) c.level = levelOf(c)
    for (const link of linkLevels(cells)) {
      for (const p of link.supports) store.addEdge(cellNode(p), cellNode(link.id), 'supports', 1)
    }

    // 冷热 + 权重（F31 / F09 R3）
    for (const c of cells) {
      refreshTier(c, now)
      applyWeights(c, { now, tier: c.tier })
    }

    // F44：被想起得多的条目加一点（痕迹消费）
    const traceRows = await adapters.hippocampus.traces({ since: 0 })
    const recalled = traceCounts(traceRows, cells)
    for (const c of cells) {
      const n = recalled.get(c.id) || 0
      if (n) c.weight = Math.min(1.5, c.weight * recallBoost(n))
    }

    const archived = archiveCold(cells, now)
    const interference = findInterference(cells)

    // 锁存 + 审计（F16 / F19）
    let latch = null
    if (!dryRun) {
      latch = await commit(store, meta, { batch: processed, promoted, conflicts: conflicted, mode })
      await log({ kind: 'distill', mode, processed, promoted, conflicts: conflicted, patterns: newPatterns, rules: newRules, archived: archived.length })
      const keys = Object.keys(meta.distilled)
      if (keys.length > 500) {
        for (const k of keys.slice(0, keys.length - 500)) delete meta.distilled[k]
      }
      await writeMeta(meta)
    }

    return {
      processed,
      promoted,
      promotedIds,
      conflicts: conflicted,
      conflictIds,
      patterns: newPatterns,
      archived: archived.length,
      interference: interference.length,
      lastAt,
      mode,
      dryRun,
      latch,
    }
  }

  return { run, pending, BATCH, DEEP_BATCH }
}
