// 内存态：episodes 表 + 指纹倒排 + 打开的 segment + 图。
// 对应：L1-15 指纹索引、L2-3 图、L2-4 序列、L2-8 层级坐标、L4-12 transferState。

import { readJsonl, FILES } from './store.js'
import { bucketKey } from './fingerprint.js'

export const GAP_MS = 15 * 60 * 1000 // 空闲 15 分钟断段（L0-3）

export function newEpisodeId(session, ts) {
  const s = String(session || 'anon').replace(/[^a-zA-Z0-9]/g, '').slice(-8) || 'anon'
  const t = Number(ts).toString(36)
  const r = Math.random().toString(36).slice(2, 6)
  return `ep_${s}_${t}_${r}`
}

export function newRawId() {
  return `raw_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}

/** 一条 raw 的“消息身份”（L0-2）。 */
export function messageKey(input) {
  if (input.channel && input.msgId) return `${input.channel}:${input.msgId}`
  return null
}

/**
 * 「人」的标识。记忆除了挂会话，还挂这个——换窗口也认得出是同一个人。
 * 单用户场景固定 master；多用户/多身份再扩展。
 */
export const OWNER = 'master'

export class HippoStore {
  constructor() {
    this.episodes = new Map()      // id → episode
    this.byBucket = new Map()      // bucketKey → Set<episodeId>
    this.bySession = new Map()     // session → [episodeId] 按时间
    this.byOwner = new Map()       // owner → [episodeId] 按时间（跨窗口）
    this.openBySession = new Map() // session → episodeId
    this.seenMessages = new Map()  // messageKey/hash → at
    this.graph = { nodes: new Map(), edges: [] }
    this.pendingEdges = []   // 增量边，tick 时刷到 links.jsonl
    this.loaded = false
  }

  async init() {
    if (this.loaded) return this
    const rows = await readJsonl(FILES.episodes)
    // episodes 是 append-only：同一个 id 会有多行，取 version 最大的那行
    const latest = new Map()
    for (const ep of rows) {
      if (!ep?.id) continue
      const cur = latest.get(ep.id)
      if (!cur || Number(ep.version || 0) >= Number(cur.version || 0)) latest.set(ep.id, ep)
    }
    for (const ep of latest.values()) this.addEpisode(ep)

    // links.jsonl 是增量边。不读回来的话，图重启就归零（rebuild 建了 160 节点、
    // 一重启 nodes:0 —— 图扩散召回等于废了）。
    try {
      const links = await readJsonl(FILES.links)
      for (const e of links) {
        if (!e?.from || !e?.to) continue
        const key = e.key || `${e.from}|${e.to}|${e.kind || 'link'}`
        if (this.graph.edges.some((x) => x.key === key)) continue
        this.graph.edges.push({
          key,
          from: e.from,
          to: e.to,
          kind: e.kind || 'link',
          w: Number(e.w) || 1,
          at: e.at || 0,
        })
        for (const id of [e.from, e.to]) {
          if (!this.graph.nodes.has(id)) {
            this.graph.nodes.set(id, {
              id,
              type: String(id).startsWith('e:') ? 'event' : 'entity',
              label: String(id).replace(/^[a-z]:/, ''),
              weight: 1,
            })
          }
        }
      }
    } catch { /* 没有 links 就是第一次启动 */ }

    this.loaded = true
    return this
  }

  addEpisode(ep) {
    this.episodes.set(ep.id, ep)
    const b = bucketKey(ep.anchor.sessionId, ep.start)
    if (!this.byBucket.has(b)) this.byBucket.set(b, new Set())
    this.byBucket.get(b).add(ep.id)
    const list = this.bySession.get(ep.anchor.sessionId) || []
    if (!list.includes(ep.id)) list.push(ep.id)
    this.bySession.set(ep.anchor.sessionId, list)
    // 同时挂到"人"名下：老数据没有 owner 字段，按 master 兜底
    const owner = ep.owner || OWNER
    const olist = this.byOwner.get(owner) || []
    if (!olist.includes(ep.id)) olist.push(ep.id)
    this.byOwner.set(owner, olist)
    if (ep.state === 'open') this.openBySession.set(ep.anchor.sessionId, ep.id)
  }

  get(id) {
    return this.episodes.get(id) || null
  }

  touch(ep) {
    this.episodes.set(ep.id, ep)
  }

  /** 同会话、同桶 + 前后各一桶的候选（L1-15 只查桶，不扫全表）。 */
  candidates(session, ts) {
    const out = []
    const base = new Date(ts)
    for (const offset of [-1, 0, 1]) {
      const t = new Date(base.getTime() + offset * 3600 * 1000)
      const ids = this.byBucket.get(bucketKey(session, t.getTime()))
      if (!ids) continue
      for (const id of ids) {
        const ep = this.episodes.get(id)
        if (ep && ep.state !== 'archived') out.push(ep)
      }
    }
    return out
  }

  openEpisode(session) {
    const id = this.openBySession.get(session)
    const ep = id ? this.episodes.get(id) : null
    return ep && ep.state === 'open' ? ep : null
  }

  closeIfStale(session, now, gapMs = GAP_MS) {
    const ep = this.openEpisode(session)
    if (!ep) return null
    const gap = now - Number(ep.end || ep.start)
    const crossedDay = new Date(ep.end).toDateString() !== new Date(now).toDateString()
    if (gap > gapMs || crossedDay) {
      ep.state = 'closed'
      ep.closedAt = now
      this.openBySession.delete(session)
      return ep
    }
    return null
  }

  sessionEpisodes(session) {
    return (this.bySession.get(session) || []).map((id) => this.episodes.get(id)).filter(Boolean)
  }

  /**
   * 跨窗口：属于同一个"人"的最近 N 条（不含已归档）。
   * 新窗口本会话没数据时用它兜底，这样换个窗口还认得出是你。
   */
  ownerEpisodes(owner = OWNER, limit = 5) {
    const ids = this.byOwner.get(owner) || []
    const out = []
    for (let i = ids.length - 1; i >= 0 && out.length < limit; i -= 1) {
      const ep = this.episodes.get(ids[i])
      if (ep && ep.state !== 'archived') out.push(ep)
    }
    return out.reverse()
  }

  allEpisodes() {
    return [...this.episodes.values()]
  }

  // ── 图（L2-3）：节点 = 实体/事件，边 = 共现/时间/相似 ──────────
  addNode(id, type, label) {
    if (!this.graph.nodes.has(id)) this.graph.nodes.set(id, { id, type, label, weight: 1 })
    else this.graph.nodes.get(id).weight += 1
  }

  addEdge(from, to, kind, w = 1) {
    if (!from || !to || from === to) return
    const key = `${from}|${to}|${kind}`
    const hit = this.graph.edges.find((e) => e.key === key)
    if (hit) {
      hit.w += w
    } else {
      const edge = { key, from, to, kind, w, at: Date.now() }
      this.graph.edges.push(edge)
      this.pendingEdges.push(edge)
    }
  }

  neighbors(id, hops = 1) {
    let frontier = new Set([id])
    const seen = new Set([id])
    for (let h = 0; h < hops; h++) {
      const next = new Set()
      for (const e of this.graph.edges) {
        if (frontier.has(e.from) && !seen.has(e.to)) { seen.add(e.to); next.add(e.to) }
        if (frontier.has(e.to) && !seen.has(e.from)) { seen.add(e.from); next.add(e.from) }
      }
      frontier = next
      if (!frontier.size) break
    }
    return [...seen].filter((x) => x !== id)
  }

  stats() {
    const eps = this.allEpisodes()
    return {
      episodes: eps.length,
      open: eps.filter((e) => e.state === 'open').length,
      closed: eps.filter((e) => e.state === 'closed').length,
      consolidated: eps.filter((e) => e.state === 'consolidated').length,
      archived: eps.filter((e) => e.state === 'archived').length,
      nodes: this.graph.nodes.size,
      edges: this.graph.edges.length,
    }
  }
}
