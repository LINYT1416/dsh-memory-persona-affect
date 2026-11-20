let notePending = new Map()
// 记忆桥：情绪内核只读四个记忆器官，绝不写它们的库。
//   memory.cortex      事实 / 概念
//   memory.hippocampus 情节 / 原文
//   memory.prefrontal  判断 / 计划（只读判断，不写）
//   memory.amygdala    显著性 / 负性关联
// 任何一个不在，就返回 null，情绪照跑。

import { mkdirSync, appendFileSync, existsSync, readFileSync, writeFileSync, renameSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'

const num = (x) => (Number.isFinite(Number(x)) ? Number(x) : 0)
const cut = (s, n) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, n)

// 检索要的是"词"，不是带标点的整句：`你行不行啊，这都做不好` 里的逗号会让 BM25 命中掉光。
// 只剥标点、留字词，压到 40 字。
const queryOf = (s) => cut(String(s ?? '').replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim(), 40)
const listOf = (r) => (Array.isArray(r) ? r : Array.isArray(r?.hits) ? r.hits : Array.isArray(r?.results) ? r.results : Array.isArray(r?.episodes) ? r.episodes : [])

// 情绪写回条目：type 是 emotion，或老数据只有文本前缀。两路都要挡——
// 只认 type 会漏老数据，只认前缀会漏将来改过 type 的新数据。
// 三个文本字段都要看：消费方可能先拿到 brief，而老数据的标签只在 summary 里，
// 只看"第一个非空字段"会漏（这是测试抓出来的，不是想出来的）。
const EMOTION_TAG = '【情绪】'
const isEmotionRow = (x) => x?.type === 'emotion'
  || ['brief', 'summary', 'text'].some((k) => String(x?.[k] ?? '').startsWith(EMOTION_TAG))

function notesPath() {
  const home = process.env.DSH_HOME || join(homedir(), '.dsh')
  return join(home, 'affect', 'memory-notes.jsonl')
}

function readNotes(max = 2000) {
  const p = notesPath()
  if (!existsSync(p)) return []
  const rows = []
  for (const line of readFileSync(p, 'utf8').split('\n').filter(l => l.trim()).slice(-max)) {
    try { rows.push(JSON.parse(line.replace(/^\uFEFF/, ''))) } catch { /* 坏行跳过，不整体失败 */ }
  }
  return rows
}

function pickText(v) {
  if (v == null) return ''
  if (typeof v === 'string') return v
  if (Array.isArray(v)) return v.map(pickText).filter(Boolean).join('')
  if (typeof v === 'object') return pickText(v.text ?? v.summary ?? v.content ?? v.message?.text ?? v.parts)
  return String(v)
}

/**
 * 这句话值不值得记。
 * 人的记忆不是录音：只有"以后可能还会提到"的才留。
 * 打分靠这几类线索：偏好/打算、关于自己的事实、具体事件、情绪；寒暄和口令直接扣光。
 */
export function importanceOf(text) {
  const t = String(text || '').trim()
  if (!t) return 0
  if (/^(?:[嗯哦好行对是的收到啊呀哈嘿]{1,4}|重启完了?|重启完啦|重启好了|好了|开始吧|谢谢)[。！!？~～]*$/.test(t)) return -5
  let score = 0
  if (/喜欢|讨厌|不喜欢|想吃|想喝|想买|想去看|最爱|受不了/.test(t)) score += 3
  if (/打算|计划|准备|以后|下次|将来|明天要|后天要|想去/.test(t)) score += 2
  if (/我叫|名字|住在|老家|生日|电话|微信|学校|专业|大学|公司|上班|养了|我的猫|我的狗/.test(t)) score += 3
  if (/今天|昨天|明天|上周|下周|周末|刚才|早上|晚上|中午/.test(t)) score += 1
  if (/难受|开心|高兴|烦|累|委屈|生气|害怕|紧张|孤单|幸福/.test(t)) score += 2
  if (/因为|所以|但是|其实|觉得|感觉/.test(t)) score += 1
  if (t.length >= 12) score += 1
  if (t.length >= 30) score += 1
  return score
}

const IMPORTANCE_LINE = 2

export function createBridge(get) {
  const safe = (fn, fallback = null) => {
    try { return fn() ?? fallback } catch { return fallback }
  }
  const organ = (id) => safe(() => get(id), null)
  let lastFast = null
  let schemaCache = []
  let schemaFetchedAt = 0
  let lastSchema = null
  // 写回对账本：只记"发出去几次、对方收了几次、错了几次"。
  // 没有它，writebackStats 里的 177 条只能证明"本地账本写了 177 行"，
  // 证明不了记忆那头收了几条——这正是假阳性的来源。
  const deliver = {
    attempted: 0,
    landed: 0,
    failed: 0,
    skipped: 0,
    lastSkip: null,
    lastError: null,
    lastAttemptAt: 0,
    lastOkAt: 0,
  }

  return {
    ready: () => ['memory.cortex', 'memory.hippocampus', 'memory.prefrontal', 'memory.amygdala'].some(id => !!organ(id)),

    status() {
      return {
        ready: this.ready(),
        organs: {
          cortex: !!organ('memory.cortex'),
          hippocampus: !!organ('memory.hippocampus'),
          prefrontal: !!organ('memory.prefrontal'),
          amygdala: !!organ('memory.amygdala'),
        },
        lastFast,
        // 写回到底落了几条：这个数字和本地账本的行数对不上，就说明有一头在说谎
        writeback: this.writebackTruth(),
      }
    },

    /** 这件事以前发生过吗：返回 {hits:[{id,brief,valence}], tone} */
    recall(text) {
      const hip = organ('memory.hippocampus')
      if (!hip || typeof hip !== 'object') return null
      // 记忆提供的 recall 是 async（返回 Promise）→ 优先用同步版 recallSync。
      const fn = typeof hip.recallSync === 'function'
        ? hip.recallSync
        : (typeof hip.recall === 'function' ? hip.recall : null)
      if (!fn) return null
      const raw = safe(() => fn.call(hip, queryOf(text), { includeEmotion: true }), null)
      if (raw && typeof raw.then === 'function') return null
      const hits = listOf(raw)
        .map(x => ({
          id: x?.episodeId ?? x?.id ?? null,
          brief: cut(String(pickText(x?.brief ?? x?.summary ?? x?.text)), 24),
          valence: num(x?.valence),
        }))
        .filter(h => h.brief)
        .slice(0, 3)
      if (!hits.length) return null
      return { hits, tone: hits.reduce((s, h) => s + h.valence, 0) / hits.length }
    },

    /** 真海马体的召回是 async：等它回来，形状统一成 {hits,tone} */
    async recallAsync(text) {
      const hip = organ('memory.hippocampus')
      if (!hip || typeof hip !== 'object') return null
      let raw = null
      if (typeof hip.recallAsync === 'function') raw = await safe(() => hip.recallAsync(queryOf(text), { includeEmotion: true }), null)
      if (!raw && typeof hip.recall === 'function') raw = await safe(() => hip.recall(queryOf(text), { includeEmotion: true }), null)
      const hits = listOf(raw)
        .map(x => ({
          id: x?.episodeId ?? x?.id ?? null,
          brief: cut(x?.brief ?? x?.summary ?? x?.text ?? '', 24),
          valence: num(x?.valence),
          kind: x?.kind ?? null,
          at: x?.at ?? null,
        }))
        .filter(h => h.brief)
        .slice(0, 3)
      if (!hits.length) return null
      return { hits, tone: hits.reduce((s, h) => s + h.valence, 0) / hits.length }
    },

    /** 最近记忆里发生了什么（只读，异步） */
    async recentEpisodes(limit = 6, days = 5) {
      const hip = organ('memory.hippocampus')
      if (!hip || typeof hip.episodes !== 'function') return null
      const since = Date.now() - Math.max(1, num(days)) * 86400_000
      // 多要一些：情绪条目会被滤掉，按 limit 要会导致滤完不够数
      const ask = Math.max(limit * 3, limit)
      const raw = await safe(() => hip.episodes({ limit: ask, since }), null) ?? await safe(() => hip.episodes(ask), null)
      const list = listOf(raw)
        // 【情绪】条目的摘要是"有情绪：xxx"，信息量接近零。
        // recall 路径早就挡了（recall.js 的 keep()），这里以前没挡，
        // 结果 DMN 的"最近发生了什么"六条全是【情绪】——有数据，但内容是垃圾。
        .filter(x => !isEmotionRow(x))
        .map(x => ({
          id: x?.episodeId ?? x?.id ?? null,
          brief: cut(x?.brief ?? x?.summary ?? '', 32),
          // 没有 valence 就明确 null，不写成 0：0 是"中性"，null 是"不知道"。
          // 这两件事在下游（心境重排、怀旧）里完全不同。
          valence: Number.isFinite(Number(x?.valence)) ? Number(x?.valence) : null,
          at: x?.at ?? null,
        }))
        .filter(x => x.brief)
        .slice(-limit)
      return list.length ? list : null
    },

    /** 显著性：记忆侧给分，没接上就用长度/标点估一个 */
    salience(text) {
      const amy = organ('memory.amygdala')
      const v = amy && typeof amy.salience === 'function' ? safe(() => amy.salience(text), null) : null
      if (v != null && Number.isFinite(Number(v))) return Number(v)
      return null
    },

    /**
     * 人格的"显著性先验"：只说这件事该记得多深，不替记忆做决定。
     * 拿不到就 null——不拿 0 假装"没有偏好"。
     */
    personaPrior() {
      const p = organ('memory.persona')
      if (!p || typeof p.memoryPrior !== 'function') return null
      const v = safe(() => p.memoryPrior(), null)
      if (!v || typeof v !== 'object') return null
      const deepBias = Number(v.deepBias)
      if (!Number.isFinite(deepBias)) return null
      return {
        deepBias: Math.min(1, Math.max(0, deepBias)),
        salienceGain: Number.isFinite(Number(v.salienceGain)) ? Number(v.salienceGain) : 1,
      }
    },

    /** 负性关联：这件事以前是不是有坏印象 */
    caution(text) {
      const amy = organ('memory.amygdala')
      if (!amy || typeof amy.caution !== 'function') return null
      const v = safe(() => amy.caution(text), null)
      return v != null && Number.isFinite(Number(v)) ? Number(v) : null
    },

    /** 事实 / 概念：只读 cortex */
    facts(text, k = 3) {
      const cx = organ('memory.cortex')
      if (!cx || typeof cx.search !== 'function') return []
      const raw = safe(() => cx.search(cut(text, 120), k), null)
      return listOf(raw).map(x => String(x?.text ?? x?.brief ?? x?.summary ?? '')).filter(Boolean).slice(0, k)
    },

    /** 记忆侧的心情趋势（她自己的统计），没有就 null */
    memoryTrend(days = 7) {
      const hip = organ('memory.hippocampus')
      if (!hip || typeof hip.moodTrend !== 'function') return null
      return safe(() => hip.moodTrend({ days: Math.max(1, Math.min(365, num(days))) }), null)
    },

    /** 长期统计：给人格层看的聚合量（只有计数/均值，没有原话） */
    stats(days = 7) {
      const out = { days, n: 0, byKind: {}, valenceMean: 0, intensityMean: 0, deepShare: 0, moodMean: 0, lastAt: null, invalid: 0, unnamed: 0, byDay: [] }
      const since = Date.now() - Math.max(1, num(days)) * 86400_000
      const rows = readNotes().filter(x => {
        if (!x.at) return true
        const t = Date.parse(x.at)
        return Number.isNaN(t) ? true : t >= since
      })
      if (!rows.length) return out
      const byDay = new Map()
      let v = 0, i = 0, m = 0, deep = 0, invalid = 0, unnamed = 0, usable = 0
      for (const r of rows) {
        const kind = String(r.kind || '').trim()
        if (!kind || /^[a-z0-9]{1,2}$/i.test(kind)) { invalid += 1; continue }
        if (r.named === false || kind === '有情绪') unnamed += 1
        else out.byKind[kind] = (out.byKind[kind] || 0) + 1
        v += num(r.valence); i += num(r.intensity); m += num(r.mood)
        if (r.depth === 'deep') deep += 1
        usable += 1
        const t = Date.parse(r.at)
        if (!Number.isNaN(t)) {
          const d = new Date(t)
          const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
          const cell = byDay.get(key) || { day: key, n: 0, sum: 0, deep: 0 }
          cell.n += 1; cell.sum += num(r.valence); if (r.depth === 'deep') cell.deep += 1
          byDay.set(key, cell)
        }
        if (!out.lastAt || (r.at && r.at > out.lastAt)) out.lastAt = r.at || out.lastAt
      }
      out.n = usable
      out.invalid = invalid
      out.unnamed = unnamed
      out.valenceMean = Number((v / Math.max(1, usable)).toFixed(3))
      out.intensityMean = Number((i / Math.max(1, usable)).toFixed(3))
      out.moodMean = Number((m / Math.max(1, usable)).toFixed(3))
      out.deepShare = Number((deep / Math.max(1, usable)).toFixed(3))
      out.byDay = [...byDay.values()].sort((a, b) => a.day.localeCompare(b.day))
        .map(c => ({ day: c.day, n: c.n, valenceMean: Number((c.sum / c.n).toFixed(3)), deep: c.deep }))
      return out
    },

    /** 把脏样本（坏 JSON / 空 kind / 单字母分类）挪去归档文件，原文件只留干净行 */
    archiveInvalid() {
      try {
        const p = notesPath()
        if (!existsSync(p)) return { ok: true, moved: 0, kept: 0 }
        const lines = readFileSync(p, 'utf8').split('\n').filter(l => l.trim())
        const good = []
        const bad = []
        for (const l of lines) {
          let o = null
          try { o = JSON.parse(l.replace(/^\uFEFF/, '')) } catch { o = null }
          const kind = String(o?.kind ?? '').trim()
          if (!o || !kind || /^[a-z0-9]{1,2}$/i.test(kind)) bad.push(l)
          else good.push(l)
        }
        if (!bad.length) return { ok: true, moved: 0, kept: good.length }
        const dir = join(p, '..')
        const arch = join(dir, 'memory-notes.invalid.jsonl')
        appendFileSync(arch, bad.join('\n') + '\n', 'utf8')
        const tmp = p + '.tmp'
        writeFileSync(tmp, good.length ? good.join('\n') + '\n' : '', 'utf8')
        renameSync(tmp, p)
        return { ok: true, moved: bad.length, kept: good.length, archive: arch }
      } catch (e) {
        return { ok: false, error: String(e?.message || e) }
      }
    },

    /** 最近一次同步召回的结论（engine 用它决定要不要退回异步） */
    fastStage() { return lastFast?.stage || null },

    /** 只读探测：不影响 lastFast（诊断路由用它，免得把真实那拍的结论覆盖掉） */
    probe(text, opts = {}) {
      const hip = organ('memory.hippocampus')
      if (!hip || typeof hip.recallSync !== 'function') return { stage: 'no-method', hits: [] }
      let r = null
      try {
        r = hip.recallSync(queryOf(text), {
          valence: num(opts.valence), arousal: num(opts.arousal), limit: Number(opts.limit) || 3,
          includeEmotion: true,
          excludeMsgId: opts.excludeMsgId || null, beforeMs: opts.beforeMs || null,
        })
      } catch (e) { return { stage: 'threw', error: String(e?.message || e), hits: [] } }
      if (!r) return { stage: 'null-result', hits: [] }
      if (r.ok === false) return { stage: 'ok-false', reason: String(r.reason || ''), hits: [] }
      const hits = listOf(r).slice(0, 3).map(x => ({
        id: x?.id ?? x?.episodeId ?? null,
        brief: cut(x?.brief ?? x?.summary ?? x?.text ?? '', 24),
        valence: num(x?.valence),
        salience: num(x?.salience),
        score: num(x?.score),
        at: Number(x?.at ?? x?.start ?? 0) || 0,
      })).filter(h => h.brief)
      return {
        stage: hits.length ? 'ok' : 'empty-hits', hits,
        degraded: !!(r.degraded ?? r.flags?.degraded),
        valenceReady: !!(r.valenceReady ?? r.flags?.valenceReady),
      }
    },

    /** 图式：从记忆皮层挑几条高置信度概念（同一谓词反复出现才够格） */
    schemas(text, k = 3) {
      const dbg = { at: Date.now(), hasCortex: false, hasFn: false, shapes: [], raw: 0, err: null, sample: null }
      lastSchema = dbg
      const cx = organ('memory.cortex')
      dbg.hasCortex = !!cx
      if (!cx) return null
      const fn = cx.concepts || cx.searchConcepts
      if (typeof fn !== 'function') return null
      dbg.hasFn = true
      const q = queryOf(text)
      let items = []
      for (const call of [
        () => fn.call(cx, q, k * 2),
        () => fn.call(cx, q, { limit: k * 2 }),
        () => fn.call(cx, { query: q, k: k * 2 }),
        // 概念检索是按查询词打分的：她这句话和现存概念对不上时会给 0 条。
        // 图式问的是"她已经认定了什么"，本来就不依赖这一句 —— 空查询取前几条。
        () => fn.call(cx, '', k * 2),
        () => fn.call(cx, '*', k * 2),
      ]) {
        try {
          const r = call()
          const list = Array.isArray(r?.items) ? r.items : (Array.isArray(r) ? r : [])
          dbg.shapes.push({ kind: Array.isArray(r) ? 'array' : typeof r, n: list.length })
          if (list.length) { items = list; break }
        } catch (e) { dbg.err = String(e?.message || e) }
      }
      dbg.raw = items.length
      dbg.sample = items.slice(0, 2)
      // conceptsSync 对任何查询都给 0 条（实测 5 种调用形状全是 0），
      // 但 stats() 里带着真实概念。异步刷一份，同步读缓存。
      if (!items.length && (Date.now() - schemaFetchedAt > 5000)) {
        schemaFetchedAt = Date.now()
        try {
          Promise.resolve(cx.stats ? cx.stats() : null).then((st) => {
            const list = st?.concepts || st?.cortex?.concepts || st?.data?.concepts
            if (Array.isArray(list)) { schemaCache = list; dbg.fromStats = list.length }
          }).catch(() => {})
        } catch { /* 取不到就用空的 */ }
      }
      if (!items.length && schemaCache.length) {
        items = schemaCache
        dbg.usedCache = true
      }
      const out = []
      const seen = new Set()
      for (const it of items) {
        const pred = String(it?.predicate ?? it?.kind ?? '').trim()
        const obj = String(it?.object ?? it?.value ?? '').trim()
        if (!pred || !obj) continue
        const conf = Number(it?.confidence ?? it?.score ?? it?.relevance ?? NaN)
        if (Number.isFinite(conf) && conf < 0.5) continue
        const line = `${pred}：${cut(obj, 18)}`
        if (seen.has(line)) continue
        seen.add(line)
        out.push(line)
        if (out.length >= k) break
      }
      return out
    },

    /** 把这一拍的对话交给记忆侧落库。
     *  宿主的事件钩子在 web 会话里没送达（实测 raw 里只有情绪回写），
     *  而心情插件每一拍都拿得到 user/assistant 原文，所以从这条稳的路补进去。 */
    noteText(session, role, text, at) {
      const hip = organ('memory.hippocampus')
      if (!hip || typeof hip.write !== 'function') return false
      const t = pick(text).trim()
      if (!t) return false

      // 人不是把所有话都记住的。这里三件事：
      // 1) 寒暄、口令式的短句不进记忆（"嗯""好""重启完了"这种过一天就没用了）
      // 2) 她说的先攒着，等我的回复来了，合成一条"一问一答"再落库
      // 3) 攒太久（10 分钟）还没回复，就单独落，别丢
      const sid = String(session || 'affect')
      if (!notePending) notePending = new Map()
      const now = Date.now()

      const trivial = /^(?:[嗯哦好行对是的收到啊呀哈嘿]{1,4}|重启完了?|重启完啦|重启好了|好了|开始吧)[。！!？~～]*$/
      const writeOne = (body, meta) => {
        try {
          Promise.resolve(hip.write({ session: sid, role: 'user', text: body, at: Number(meta?.at) || now, channel: 'affect-pair', force: true }))
            .catch(() => {})
          return true
        } catch { return false }
      }

      if (role === 'user') {
        const prev = notePending.get(sid)
        const worth = importanceOf(t) >= IMPORTANCE_LINE
        notePending.set(sid, { text: t, at: now, trivial: trivial.test(t) || !worth })
        // 上一轮一直没等到回复：先把上一轮单独落掉一个
        if (prev && now - prev.at > 10 * 60 * 1000) {
          if (!prev.trivial) writeOne(prev.text, prev)
          notePending.set(sid, { text: t, at: now, trivial: trivial.test(t) })
        }
        return true
      }

      // assistant：跟前面那句合成一条
      const pend = notePending.get(sid)
      notePending.delete(sid)
      if (pend && !pend.trivial) {
        const mine = t.length > 80 ? t.slice(0, 80).replace(/\s+/g, ' ') + '…' : t.replace(/\s+/g, ' ')
        return writeOne('她说：' + pend.text + '\n我说：' + mine, pend)
      }
      // 没有待配对的话（比如我先开口），只留一句极短的动作摘要
      if (t.length > 40) return false
      return writeOne('我说：' + t.replace(/\s+/g, ' '), { at: now })
    },

    /** 只读：上一次图式取数的真实形状（诊断用） */
    schemaDebug() { return lastSchema },

    /** 同步粗召回：记忆侧有 recallSync 就用它（BM25/图/概念，毫秒级），没有就返回 null 由调用方退回异步 */
    recallFast(text, opts = {}) {
      const diag = (stage, extra = {}) => { lastFast = { at: Date.now(), stage, ...extra } }
      let pr = this.probe(text, opts)
      if (pr.stage !== 'ok' && pr.stage !== 'empty-hits') {
        diag(pr.stage, pr.error ? { error: pr.error } : pr.reason ? { reason: pr.reason } : {})
        return null
      }
      if (pr.stage === 'empty-hits') {
        diag('empty-hits', { raw: 0 })
        return null
      }
      diag('ok', { n: pr.hits.length, degraded: !!pr.degraded, ms: null })
      return { hits: pr.hits, degraded: !!pr.degraded, valenceReady: !!pr.valenceReady }
    },

    /** 情绪账本：id → 那条记忆当时的 valence（记忆侧没补 valence 时靠它对上） */
    notesLedger() {
      const map = new Map()
      for (const n of readNotes(500)) {
        const v = num(n.valence)
        if (n.id) map.set(String(n.id), v)
        if (n.brief) map.set('b:' + cut(n.brief, 24), v)
      }
      return map
    },

    /** 心境一致性重排：心情差时更容易想起同类的旧事；不惩罚相反符号 */
    moodRerank(hits, moodValence = 0, opts = {}) {
      const w = opts.degraded ? 0.075 : 0.15
      const ledger = opts.ledger || null
      const mv = num(moodValence)
      return (Array.isArray(hits) ? hits : []).map(h => {
        const ev = num(h.valence) || (ledger ? num(ledger.get(String(h.id)) ?? ledger.get('b:' + cut(h.brief, 24))) : 0)
        const bonus = w * Math.max(0, mv * ev)
        return { ...h, valence: ev, score: num(h.score || h.salience) + bonus }
      }).sort((a, b) => b.score - a.score)
    },

    /** 回告记忆侧：只发事件，记不记由它决定（不写别人的库） */
    announce(event, emit) {
      if (typeof emit !== 'function') return
      try { emit({ kind: 'affect.episode', ...event }) } catch { /* 事件通道断了不影响心跳 */ }
    },

    /** 把"那次我很难受"写回记忆：优先记忆侧 write，失败落在自己本子里（只追加） */
    annotate(note = {}, sessionId = '', mood = null) {
      const payload = {
        at: new Date().toISOString(),
        id: note.id ? String(note.id) : null,
        kind: String(note.kind ?? ''),
        named: Boolean(String(note.kind ?? '').trim()),
        valence: num(note.valence),
        intensity: num(note.intensity),
        depth: String(note.depth ?? 'normal'),
        mood: num(note.mood),
        // 人格的先验（第四条桥）：engine 算完传进来了，这里以前把它丢了，
        // 于是"人格影响记忆深度"永远查不到证据。null 就是"没拿到"，不写 0 冒充。
        prior: note.prior == null ? null : num(note.prior),
        brief: cut(note.brief, 40),
      }
      let noted = false
      let memory = 'skip'
      let wroteDone = Promise.resolve(null)
      // 说不出名字也要记，但不能混进分类统计：标成"有情绪"并带 named:false
      if (!payload.kind) payload.kind = '有情绪'
      const hip = organ('memory.hippocampus')
      if (hip && typeof hip.write === 'function') {
        const input = {
          text: `【情绪】${payload.kind}：${payload.brief}`,
          kind: 'affect',
          valence: payload.valence,
          meta: payload,
          force: true,
          bypass: true,
        }
        if (sessionId) input.session = String(sessionId)
        const m = Number(mood)
        if (Number.isFinite(m)) input.mood = m
        try {
          const r = hip.write(input)
          // 以前这里调完就 wrote = true，promise 直接吞掉 catch——
          // "写回成功"从来没有等过对方真的落盘。177 条账本对 34 条 episode 就是代价。
          // 现在拆成三件事：noted（本地账本报了）、memory（对方收没收到）、deliver（累计对账）。
          memory = 'pending'
          deliver.attempted += 1
          deliver.lastAttemptAt = Date.now()
          wroteDone = Promise.resolve(r).then(
            (v) => {
              // 记忆那边"拒收"也会正常 resolve：{skipped:'layer-off'} / {skipped:'noise'}。
              // 以前一律算 landed——这就是"账本说写回了、记忆里一条没有"的来源。
              // 现在跳过单独计数，landed 只统计真正收下的。
              const skip = v && typeof v === 'object' ? v.skipped : null
              if (skip) {
                deliver.skipped += 1
                deliver.lastSkip = String(skip)
                deliver.lastError = `skipped:${String(skip)}`
                return v
              }
              deliver.landed += 1
              deliver.lastOkAt = Date.now()
              return v
            },
            (e) => {
              deliver.failed += 1
              deliver.lastError = String(e?.message || e)
              return null
            },
          )
        } catch (e) {
          memory = 'fail'
          deliver.attempted += 1
          deliver.failed += 1
          deliver.lastError = String(e?.message || e)
        }
      }
      // 没有海马体时**不**计 attempted：这是 writeback-truth 早就钉住的约定
      // （"没接上时不该计 attempted"）。而且 engine 那边在缺器官时根本不会调这里，
      // 加了分支也是死代码——不要为了"看起来更周到"去动已经通过的契约。
      try {
        const p = notesPath()
        mkdirSync(join(p, '..'), { recursive: true })
        let prefix = ''
        try {
          const st = readFileSync(p)
          if (st.length && st[st.length - 1] !== 0x0a) prefix = '\n'
        } catch { /* 文件还不存在 */ }
        appendFileSync(p, prefix + JSON.stringify(payload) + '\n', 'utf8')
        noted = true
      } catch { /* 本地也写不了就算了 */ }
      return {
        // wrote 的含义收窄了：本地账本真的追加成功，或者记忆侧确实接了这次调用。
        // 它不再代表"记忆已落库"——那个看 memory 字段，或者 await done。
        wrote: noted || memory === 'pending',
        noted,
        memory,
        payload,
        done: wroteDone,
      }
    },

    /** 写回对账：不求好看，只求能对出来"发了几次、落了几次" */
    writebackTruth() {
      // skipped 也算"结算完"：记忆明确拒收（层关着/判定噪声）不是"还没写"。
      const settled = deliver.landed + deliver.failed + deliver.skipped
      return {
        ...deliver,
        inFlight: Math.max(0, deliver.attempted - settled),
        landedRate: deliver.attempted ? Number((deliver.landed / deliver.attempted).toFixed(3)) : null,
      }
    },
  }
}
