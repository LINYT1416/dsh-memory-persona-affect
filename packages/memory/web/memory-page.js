// 记忆仪表页：四块——这一轮 / 最近 / 长期 / 永久。
// 只读，不动任何数据。
import { readFileSync } from 'node:fs'
import { buildWorkingSet } from '../organs/prefrontal/workset.js'

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))

export function memoryPage() {
  return `<!doctype html><html lang="zh"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>她的记忆</title>
<style>
:root{color-scheme:dark}
body{margin:0;font:14px/1.6 system-ui,-apple-system,"Segoe UI",sans-serif;background:#14161a;color:#e6e8ec}
main{max-width:900px;margin:0 auto;padding:22px 20px 64px}
h1{font-size:18px;margin:0 0 4px}h2{font-size:14px;color:#9aa4b2;margin:22px 0 8px;font-weight:500}
.card{background:#1b1e24;border:1px solid #272b33;border-radius:10px;padding:12px 14px;margin:10px 0}
.small{color:#9aa4b2;font-size:12px}
pre{white-space:pre-wrap;margin:0;font:12px/1.55 ui-monospace,Consolas,monospace;color:#cfd6e4}
.row{border-top:1px solid #23272f;padding:7px 0;display:flex;gap:10px}
.row:first-child{border-top:0}
.t{color:#7d8798;font-size:12px;min-width:96px;flex:none}
.mid{flex:1;min-width:0;overflow-wrap:anywhere}
.badge{font-size:11px;padding:1px 6px;border-radius:6px;background:#232833;color:#9fb0c8}
.kv{display:grid;grid-template-columns:150px 1fr;gap:4px 10px}
button{background:#232833;color:#cfd6e4;border:0;border-radius:8px;padding:7px 14px;font:inherit;cursor:pointer}
</style></head><body><main>
<h1>她的记忆</h1>
<div class="small">只读。这一轮 = 真正进了上下文的那块压缩；最近 = 海马体原文；长期/永久 = 皮层蒸馏出来的。</div>

<h2>这一轮记住的（工作集）</h2>
<div class="card"><div id="workset" class="small">加载中…</div></div>

<h2>最近记住的（海马体）</h2>
<div class="card"><div id="recent" class="small">加载中…</div></div>

<h2>长期记住的（皮层事实）</h2>
<div class="card"><div id="facts" class="small">加载中…</div></div>

<h2>永久 / 精华（最高层）</h2>
<div class="card"><div id="perm" class="small">加载中…</div></div>

<div style="margin-top:16px"><button onclick="load()">刷新</button> <span id="msg" class="small"></span></div>
</main>
<script>
const $ = (id) => document.getElementById(id)
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))
const ts = (t) => { if (!t) return '—'; const d = new Date(Number(t)); return d.toLocaleString('zh-CN', { hour12: false }) }
async function load(){
  $('msg').textContent = ''
  try {
    const r = await fetch('/memory/data'); const j = await r.json()
    if (!j.ok) throw new Error(j.error || 'failed')
    $('workset').innerHTML = j.workset && j.workset.text
      ? '<div class="small">' + (j.workset.tokens ?? '?') + ' token · ' + (j.workset.pointers ?? 0) + ' 条指针 · ' + ts(j.workset.at) + '</div><pre>' + esc(j.workset.text) + '</pre>'
      : '<span class="small">这一轮还没有压缩结果（新会话或还没来消息）</span>'
    const rows = (list, map) => list.length
      ? list.map((x) => '<div class="row"><span class="t">' + esc(map.t(x)) + '</span><span class="mid">' + esc(map.m(x)) + '</span>' + (map.b ? '<span class="badge">' + esc(map.b(x)) + '</span>' : '') + '</div>').join('')
      : '<span class="small">空</span>'
    $('recent').innerHTML = rows(j.recent || [], { t: (x) => ts(x.at), m: (x) => x.summary, b: (x) => x.role || '' })
    $('facts').innerHTML = rows(j.facts || [], { t: (x) => ts(x.at), m: (x) => x.text, b: (x) => x.kind || 'fact' })
    $('perm').innerHTML = rows(j.permanent || [], { t: (x) => ts(x.at), m: (x) => x.text, b: (x) => x.level || 'permanent' })
  } catch (e) {
    $('msg').textContent = '读不出来：' + (e && e.message ? e.message : e)
  }
}
load()
</script></body></html>`
}

/** 服务聚合：任何一块坏了只让那块空，不影响整页 */
export async function buildMemoryData(services = {}) {
  const out = { ok: true, at: Date.now(), workset: null, recent: [], facts: [], permanent: [], errors: [] }
  const soft = async (name, fn) => { try { return await fn() } catch (e) { out.errors.push(name + ':' + String(e?.message || e)); return null } }

  const pre = services.prefrontal
  if (pre?.workset || pre?.last) {
    out.workset = await soft('workset', async () => pre.workset?.() || pre.last?.() || null)
  }

  const hip = services.hippocampus
  if (hip?.episodes) {
    const rows = await soft('recent', async () => hip.episodes({ limit: 30 }))
    const list = Array.isArray(rows) ? rows : (rows?.episodes || rows?.rows || [])
    out.recent = list.slice(-30).reverse().map((e) => ({
      at: Number(e.start ?? e.at ?? 0),
      role: e.role || '',
      summary: String(e.summary || e.brief || '').slice(0, 200),
      id: e.id || e.episodeId || '',
    })).filter((x) => x.summary)
  }

  // 服务那边还没有工作集（刚启动 / 这一拍没算）：就地按同一套规则算一份，
  // 别让页面空着——但算的是真数据，不是占位。
  if (!out.workset && out.recent.length) {
    try {
      const turns = out.recent.slice().reverse().map((x) => ({ text: x.summary, at: x.at, episodeId: x.id, role: x.role }))
      const set = buildWorkingSet(turns, { budgetTokens: 900 })
      if (set.text) out.workset = { text: set.text, tokens: set.tokens, pointers: set.kept.pointers.length, at: Date.now(), computed: 'page' }
    } catch (e) { out.errors.push('fallback:' + String(e?.message || e)) }
  }

  const cx = services.cortex
  if (cx) {
    const st = await soft('cortex.stats', async () => (cx.stats ? await cx.stats() : null))
    out.cortex = st ? { facts: st.facts ?? st.cells ?? null, concepts: st.concepts ?? null, conflicts: st.conflicts ?? null } : null
    const found = await soft('cortex.facts', async () => {
      if (cx.concepts) {
        const c = await cx.concepts('', 20)
        return (c?.items || []).map((x) => ({ at: Number(x.at || x.updatedAt || 0), text: String(x.text || x.label || x.id || ''), kind: x.predicate || x.kind || 'concept' }))
      }
      return []
    })
    out.facts = found || []
    const perm = await soft('cortex.permanent', async () => {
      if (cx.permanent) return (await cx.permanent()) || []
      return []
    })
    out.permanent = (perm || []).map((x) => ({ at: Number(x.at || 0), text: String(x.text || x.id || ''), level: x.level || 'permanent' }))
  }

  // 空数组是诚实结果：皮层没暴露清单时，页面会显示"空"，不会编
  if (!out.workset && !out.recent.length && !out.facts.length && !out.permanent.length && out.errors.length) out.ok = false
  return out
}
