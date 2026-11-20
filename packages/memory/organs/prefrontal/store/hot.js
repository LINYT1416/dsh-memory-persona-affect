// #P0-1 热区分层 / #P0-3 主动刷新 / #P0-4 主动丢弃 / #P0-6 分布式维持
// 热区不是"最近几条"，是「槽位权重」：同一条能给多个槽位加分（分布式维持的近似）。
import { readJson, writeJson } from './jsonl.js'
import { FILES, LIMITS } from './paths.js'
import { clamp } from '../kernel/text.js'

const TIERS = ['hot', 'recent', 'background']

let cache = null
let loading = null

function blank() {
  return { sessions: {} }
}

export async function load() {
  if (!cache) {
    if (!loading) {
      loading = readJson(FILES.hot, null).then((v) => {
        const st = v || blank()
        st.sessions ||= {}
        cache ||= st
        return cache
      })
    }
    await loading
  }
  return cache
}

function sess(state, sid) {
  const key = String(sid || 'default')
  state.sessions[key] ||= { items: [], updatedAt: 0, switchedAt: 0, turn: 0 }
  return state.sessions[key]
}

/**
 * 主动刷新：每轮把候选重新排档，不是追加。
 * 档位规则：本轮命中→hot；24h 内→recent；更早→background。
 * 权重：命中次数 + 新近度 + 目标相关 + 分数（一条能同时吃几个加成 = 分布式维持）。
 */
export async function refresh(sid, cands = [], ctx = {}) {
  const state = await load()
  const s = sess(state, sid)
  const now = ctx.now || Date.now()
  const prev = new Map(s.items.map((i) => [i.id, i]))

  const items = []
  for (const c of cands) {
    const id = c.episodeId || c.id
    if (!id) continue
    const old = prev.get(id)
    const age = now - (Number(c.at) || now)
    const tier = age < 10 * 60 * 1000 ? 'hot' : age < 86400000 ? 'recent' : 'background'
    const w = {
      hit: clamp((old?.w?.hit || 0) + 1, 0, 10) / 10,
      fresh: clamp(1 - age / (7 * 86400000)),
      goal: clamp(Number(c.goalFit) || 0),
      score: clamp(Number(c.score) || 0),
    }
    items.push({
      id,
      summary: String(c.summary || '').slice(0, 80),
      at: Number(c.at) || now,
      tier,
      score: Number(c.score) || 0,
      // R1：带上任务归属，任务切换时才敢保护"正在用的那几条"
      taskId: c.taskId || ctx.taskId || null,
      w,
      weight: Number((w.hit * 0.35 + w.fresh * 0.25 + w.goal * 0.25 + w.score * 0.15).toFixed(4)),
    })
  }

  // 合并旧条目：本轮没命中的降一档，不直接删（P0-4 只在任务切换时删）
  for (const old of s.items) {
    if (items.some((i) => i.id === old.id)) continue
    const tierIdx = TIERS.indexOf(old.tier)
    const nextTier = TIERS[Math.min(TIERS.length - 1, tierIdx + 1)]
    items.push({ ...old, tier: nextTier, weight: Number((old.weight * 0.8).toFixed(4)) })
  }

  items.sort((a, b) => {
    const d = TIERS.indexOf(a.tier) - TIERS.indexOf(b.tier)
    return d !== 0 ? d : b.weight - a.weight
  })

  s.items = items.slice(0, LIMITS.hotItems * 3)
  s.updatedAt = now
  s.turn = (s.turn || 0) + 1
  await writeJson(FILES.hot, state)
  return { session: sid, items: s.items, turn: s.turn }
}

/** 三档分组（给注入用）。 */
/** 工作记忆是按会话分档的；统计时不能只看 'default'。 */
export function sessionIds() {
  return cache && cache.sessions ? Object.keys(cache.sessions) : []
}

/** 最近活跃的那个会话（按 updatedAt）。没有就是 null。 */
export function latestSession() {
  const ids = sessionIds()
  let best = null
  for (const id of ids) {
    if (id === 'default') continue // 兜底桶不是会话：不参与"最近活跃"
    const s = cache.sessions[id]
    const at = Number(s?.updatedAt || 0)
    const n = (s?.items || []).length
    // 老数据没有 updatedAt（全是 0）：此时按条目数挑，空会话不许因为 key 叫 default 就胜出
    const score = [at, n, id === 'default' ? 0 : 1]
    if (!best || score[0] > best.score[0] || (score[0] === best.score[0] && (score[1] > best.score[1] || (score[1] === best.score[1] && score[2] > best.score[2])))) {
      best = { id, score }
    }
  }
  return best && best.score[1] > 0 ? best.id : null
}

export function tiers(sid) {
  const s = cache?.sessions?.[String(sid || 'default')] || { items: [] }
  return {
    hot: s.items.filter((i) => i.tier === 'hot'),
    recent: s.items.filter((i) => i.tier === 'recent'),
    background: s.items.filter((i) => i.tier === 'background'),
    updatedAt: Number(s.updatedAt || 0),
    turn: Number(s.turn || 0),
  }
}

/** #P0-1 的对外名字（单个条目问"我该在哪一档"）。 */
export function tier(sid) {
  return tiers(sid)
}

/**
 * 主动丢弃（#P0-4）：只在"真的换任务"时清，且只清背景档。
 * R1：属于当前未完成任务的条目一律不丢（哪怕它是背景档）。
 */
export async function dropOnSwitch(sid, ctx = {}) {
  const state = await load()
  const s = sess(state, sid)
  if (!ctx.justSwitched) return { dropped: 0, why: '没换任务' }
  const keepTask = ctx.keepTaskId || null
  const before = s.items.length
  s.items = s.items.filter((i) => i.tier !== 'background' || (keepTask && i.taskId === keepTask))
  s.switchedAt = ctx.now || Date.now()
  await writeJson(FILES.hot, state)
  return { dropped: before - s.items.length, kept: s.items.length, why: '换任务，清背景档（未完成的保护）' }
}

/** 整槽权重（P0-6 的"分布式"体现：不是条目数，是权重分布）。 */
export function weights(sid) {
  const s = cache?.sessions?.[String(sid || 'default')] || { items: [] }
  const sum = s.items.reduce((n, i) => n + (i.weight || 0), 0) || 1
  return s.items.map((i) => ({ id: i.id, w: Number(((i.weight || 0) / sum).toFixed(4)), tier: i.tier }))
}

export function reset() {
  loading = null
  cache = null
}
