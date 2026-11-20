// 记忆接缝：只读。
// 引擎是同步的，记忆检索是异步的——所以这里只回一份缓存，缓存由 index 在后台刷新。
// 拿不到就是空数组，不伪造。

// 情绪写回条目（【情绪】xxx）的摘要信息量接近零，不该进"最近发生了什么"。
// type 和三个文本字段都看：老数据的标签可能只在 summary 里。
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'

const EMOTION_TAG = '【情绪】'
const isEmotionRow = (h) => h?.type === 'emotion'
  || ['brief', 'summary', 'text', 'title'].some((k) => String(h?.[k] ?? '').startsWith(EMOTION_TAG))



// 新版记忆（packages/memory）不再 provide memory.hippocampus，只写盘 + 注册工具。
// 拿不到服务时，从 episodes.jsonl 读最后几条——只读，不写，不伪造。
function readDiskEpisodes(k) {
  // 显式指定了就只认它（测试和迁移都靠这个，别偷偷回落到真实数据）
  const dirs = process.env.HIPPOCAMPUS_DIR
    ? [process.env.HIPPOCAMPUS_DIR]
    : [join(homedir(), '.dsh', 'hippocampus')]
  for (const dir of dirs) {
    const file = join(dir, 'episodes.jsonl')
    if (!existsSync(file)) continue
    try {
      const lines = readFileSync(file, 'utf8').split('\n').filter(Boolean).slice(-Math.max(24, k * 4))
      const rows = []
      for (const l of lines) {
        try { rows.push(JSON.parse(l)) } catch { /* 坏行跳过 */ }
      }
      return rows
    } catch { /* 读不了就下一处 */ }
  }
  return []
}

export function createMemoryBridge(get) {
  const cache = { episodes: [], at: 0, ok: false }

  return {
    present() {
      try { return Boolean(get('memory.hippocampus')) } catch { return false }
    },

    setEpisodes(list) {
      cache.episodes = Array.isArray(list) ? list.slice(-20) : []
      cache.at = Date.now()
      cache.ok = cache.episodes.length > 0
    },

    /**
     * 更久以前的记忆：主动提起要看的是旧事，而缓存只留最近 20 条（全是今天的）。
     * 直接从盘上多读一些，同样的字段映射，同样的情绪过滤。
     */
    wide(n = 200) {
      try {
        const rows = readDiskEpisodes(Math.max(24, n))
        return rows
          .filter((h) => !isEmotionRow(h))
          .map((h) => ({
            brief: String(h.brief || h.summary || h.text || h.title || '').slice(0, 40),
            valence: (h.valence === null || h.valence === undefined || h.valence === '')
              ? null
              : (Number.isFinite(Number(h.valence)) ? Number(h.valence) : null),
            at: h.at ?? h.start ?? null,
            type: String(h.type || ''),
          }))
      } catch { return [] }
    },

    /** 引擎每帧同步取，只读缓存 */
    episodes() {
      return cache.episodes
    },

    status() {
      return {
        hippocampus: (() => { try { return Boolean(get('memory.hippocampus')) } catch { return false } })(),
        cortex: (() => { try { return Boolean(get('memory.cortex')) } catch { return false } })(),
        cached: cache.episodes.length,
        at: cache.at,
      }
    },

    /** 她自己的说话样本：扫最近 90 天的 assistant 原话，带时间戳（用于时间加权），取最新的一批 */
    async assistantSamples(k = 60) {
      let hip = null
      try { hip = get('memory.hippocampus') } catch { hip = null }
      if (!hip || typeof hip.raw !== 'function') return []
      let rows = []
      try {
        const out = await hip.raw({ days: 90, limit: 800 })
        rows = Array.isArray(out) ? out : (Array.isArray(out?.rows) ? out.rows : [])
      } catch { return [] }
      const out = []
      const seen = new Set()
      for (const r of rows) {
        const role = String(r?.role || r?.message?.role || '')
        const text = String(r?.text || r?.message?.text || r?.content || '').trim()
        if (role !== 'assistant' || text.length < 6) continue
        // 结构化写回记录不是她的话（【情绪】xxx 之类），不能拿来估语气
        if (/^【[^】]*】/.test(text)) continue
        const key = text.slice(0, 20)
        if (seen.has(key)) continue
        seen.add(key)
        out.push({ text, at: Number(r?.at || r?.ts || r?.time || r?.createdAt || 0) })
      }
      return out.slice(-Math.max(1, k))
    },

    async refresh(k = 8) {
      let hip = null
      try { hip = get('memory.hippocampus') } catch { hip = null }
      if (!hip) {
        // 新 bundle 没有服务，退到磁盘
        const rows = readDiskEpisodes(k)
        if (!rows.length) return { ok: false, reason: 'no-hippocampus' }
        this.setEpisodes(rows
          .filter((h) => !isEmotionRow(h))
          .map((h) => ({
            brief: String(h.brief || h.summary || h.text || h.title || '').slice(0, 40),
            valence: (h.valence === null || h.valence === undefined || h.valence === '') ? null
              : (Number.isFinite(Number(h.valence)) ? Number(h.valence) : null),
            at: h.at ?? h.start ?? null,
            type: String(h.type || ''),
          })))
        return { ok: true, n: cache.episodes.length, source: 'disk', dropped: rows.length - cache.episodes.length }
      }

      // 以前这里调的是 hip.recall('')：空查询在记忆侧是"直接短路返回空数组"，
      // 所以这个缓存一次也没满过——线上 cached:0、pcc.anchors:0、nostalgia:0 全是这个原因。
      // 要"最近发生过什么"应该用 episodes()，不是拿空串去检索。
      try {
        let rows = []
        if (typeof hip.episodes === 'function') {
          const raw = await hip.episodes({ limit: Math.max(3, k * 3) })
          rows = Array.isArray(raw) ? raw : []
        } else if (typeof hip.recall === 'function') {
          // 老版本没有 episodes 才退回检索，且给一个真查询（不能用空串）
          const out = await hip.recall('最近发生的事', { k })
          rows = Array.isArray(out) ? out : (out?.hits || out?.items || [])
        }
        this.setEpisodes(rows
          .filter((h) => !isEmotionRow(h))
          .map((h) => ({
            brief: String(h.brief || h.summary || '').slice(0, 40),
            // 没有效价就是 null，不拿 0 顶：0 是"中性"，null 是"不知道"。
            // 注意 Number(null) === 0 —— 必须先判空，否则 null 会被悄悄变成 0。
            valence: (h.valence === null || h.valence === undefined || h.valence === '')
              ? null
              : (Number.isFinite(Number(h.valence)) ? Number(h.valence) : null),
            at: h.at ?? null,
            type: String(h.type || ''),
          })))
        return { ok: true, n: cache.episodes.length, dropped: rows.length - cache.episodes.length }
      } catch (e) {
        return { ok: false, reason: String(e?.message || e) }
      }
    },
  }
}
