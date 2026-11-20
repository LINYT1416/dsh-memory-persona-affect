// 人格面板：模式切换 + 自定义 + 当前状态一页看完。
//
// 两种模式（这是她自己说的那套）：
//   custom —— 自定义 + 学习：手写的自述和三个旋钮先生效，长期证据仍会慢慢调别的
//   learn  —— 纯学习：手写的东西一律不生效，只按证据推（"纯学习要纯"）
//
// 存盘：<home>/persona/panel.json，跟人格状态分开（状态是它自己的，配置是人的）。
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { draftSelf } from './core/selfdraft.mjs'
import { extractStyle } from './core/style.js'
import { LOOKS, looksBias } from './core/looks.js'
import { coverage } from './core/coverage.js'

const DEFAULTS = () => ({ mode: 'custom', selfText: '', injectMax: 8, knobs: { threatGain: 1, baselineMood: 0, sensitivity: 1 }, updatedAt: 0 })

export function createPanel({ home, engine, clamp, setPersona, episodes = () => [], refreshEpisodes = async () => {}, styleSamples = async () => [], readAffect = () => null, relation = () => null, goals = () => null, conflicts = () => 0, possess = () => null, crave = () => null, worth = () => null, habit = () => null, keyPeriod = () => null, consistency = () => null, identity = () => null, speakers = () => null, storyline = () => null, interlocutor = () => null, ritual = () => null, reciprocity = () => null, majorEvent = () => null, ostracism = () => null, legacy = () => null, retired = () => [], boundary = () => null, repair = () => null, integrated = () => null, maintenance = () => null }) {
  const dir = join(home, 'persona')
  const file = join(dir, 'panel.json')

  let state = DEFAULTS()
  let lastDraft = null
  try { state = { ...DEFAULTS(), ...JSON.parse(readFileSync(file, 'utf8')) } } catch { /* 第一次跑没有文件 */ }

  function save() {
    state.updatedAt = Date.now()
    try {
      mkdirSync(dir, { recursive: true })
      writeFileSync(file, JSON.stringify(state, null, 2), 'utf8')
      return true
    } catch { return false }
  }

  // 三个旋钮真正的落点是心情那边的 affect.core.retune({ persona })。
  // 写人格自己的 engine.personaParams 是没用的——那份参数没有下游读者，
  // 之前那版就是这么"看起来改了、其实没生效"的。
  function knobs() {
    const k = state.knobs || {}
    const num = (v, lo, hi, cur) => (Number.isFinite(Number(v)) ? clamp(Number(v), lo, hi) : cur)
    return {
      threatGain: num(k.threatGain, 0.5, 2, 1),
      baselineMood: num(k.baselineMood, -0.2, 0.2, 0),
      sensitivity: num(k.sensitivity, 0.5, 2, 1),
    }
  }

  function applyKnobs() {
    if (state.mode !== 'custom') return { ok: false, reason: 'learn-mode' }
    try { return setPersona(knobs()) ?? { ok: true } } catch { return { ok: false, reason: 'no-affect' } }
  }

  // 纯学习模式下这段一律不给：手写的人设不许偷偷混进去
  function extraText() {
    if (state.mode !== 'custom') return ''
    const t = String(state.selfText || '').trim()
    return t ? `她自己认的样子（主人写的，优先级高于推断）：\n${t}` : ''
  }

  function snapshot() {
    const f = engine.read() || {}
    const h = engine.health?.() || {}
    let a = null
    try { a = readAffect() } catch { a = null }
    return {
      mode: state.mode,
      selfText: state.selfText,
      injectMax: Number(state.injectMax) || 8,
      // X01/X02/X03：从她自己的自述例句里量出来的口吻（不是说明书句式）
      // 优先量她真正说过的话（记忆里的「我说：…」），不够再退回自述。
      // 自述是「她觉得自己怎么说话」，原句才是「她怎么说话」。
      style: (() => {
        const mine = (episodes() || [])
          .map((e) => String(e?.brief || ''))
          .filter((b) => b.startsWith('我说'))
          .map((b) => b.replace(/^我说[：:]\s*/, '').trim())
          .filter((b) => b.length >= 4)
          // 技术汇报不是她的口吻：代码块/表格/标题/超长段一律不进语料
          // （不然我自己写的长报告会被当成"她说话很长"，反过来让她越说越长）
          .filter((b) => b.length <= 80 && !/```|##|\|/.test(b))
        if (mine.length >= 5) {
          const base = extractStyle(mine.join('\n'))
          // 语气词住在短消息里。长回复是「说明文模式」，拿它量语气词必然量成 0。
          const short = mine.filter((b) => b.length <= 40)
          const sp = short.length >= 5 ? extractStyle(short.join('\n')) : null
          return {
            ...base,
            particleRate: sp ? sp.particleRate : base.particleRate,
            particleSource: sp ? 'short' : 'all',
            particles: sp ? sp.particles : base.particles,
            shortSamples: short.length,
            source: 'episodes',
            samples: mine.length,
          }
        }
        const st = extractStyle(state.selfText)
        return st ? { ...st, source: 'selfText', samples: 0 } : null
      })(),
      // A01/A02/A03：主人手写的外表/音色/姿态（聊天记录里取不到，只认手写）
      looks: LOOKS,
      // 关系账本：欠不欠人情、熟到什么程度
      // 覆盖率：83 个读数里真正被用上的有几个（扫源码算，不靠手写清单）
      coverage: (() => {
        try {
          const r = (engine.read() || {}).reads || {}
          const c = coverage(r)
          return { total: c.total, used: c.used, ratio: c.ratio, unused: c.unusedKeys.length }
        } catch { return null }
      })(),

      // D03 关键期：仪表页要能看到"那段还没过去"
      keyPeriod: (() => { try { return typeof keyPeriod === 'function' ? keyPeriod() : null } catch { return null } })(),
      // H01 行为固化：仪表页要能看到哪件事已经养成习惯了
      habit: (() => { try { return typeof habit === 'function' ? habit() : null } catch { return null } })(),
      // S02 自尊：仪表页要能看到现在值多少（不是占位）
      worth: (() => { try { return typeof worth === 'function' ? worth() : null } catch { return null } })(),
      // H03 瘾头：仪表页要能看到"最近反复想什么"
      crave: (() => { try { return typeof crave === 'function' ? crave() : null } catch { return null } })(),
      // R06 嫉妒：仪表页要能看到"酸到什么程度"
      possess: (() => { try { return typeof possess === 'function' ? possess() : null } catch { return null } })(),

      // M11 目标结果 / S10 冲突队列：仪表页要能看见，而不是只有内部有
      goals: (() => { try { return typeof goals === 'function' ? goals() : null } catch { return null } })(),
      conflicts: (() => { try { return typeof conflicts === 'function' ? conflicts() : 0 } catch { return 0 } })(),

      relation: (() => {
        try {
          const r = typeof relation === 'function' ? relation() : null
          return r || null
        } catch { return null }
      })(),
      // 六个器官的读数：仪表页要能看到真的数，而不是只有一句概括
      organs: (() => {
        const r = (engine.read() || {}).reads || {}
        const pick = (o, keys) => Object.fromEntries(keys.filter((k) => o && o[k] !== undefined).map((k) => [k, o[k]]))
        return {
          str: pick(r.str, ['s', 'wanting', 'satiation']),
          tpj: pick(r.tpj, ['air', 'offense', 'misread', 'intent']),
          ofc: pick(r.ofc, ['warm', 'shame', 'unfair', 'guilt']),
          acc: pick(r.acc, ['conflict', 'error', 'primed']),
          mpfc: pick(r.mpfc, ['esteem', 'idealGap', 'discomfort', 'presentation']),
          pcc: pick(r.pcc, ['crisis', 'continuity', 'nostalgia', 'future']),
        }
      })(),
      looksBias: looksBias(),
      knobs: state.knobs,
      // S09 / S08 / R12 / S03 / H02：这些状态也得能在仪表页上看见，不能只活在 index 里
      consistency: (() => { try { return consistency() ?? null } catch { return null } })(),
      identity: (() => { try { return identity() ?? null } catch { return null } })(),
      speakers: (() => { try { return speakers() ?? null } catch { return null } })(),
      storyline: (() => { try { return storyline() ?? null } catch { return null } })(),
      interlocutor: (() => { try { return interlocutor() ?? null } catch { return null } })(),
      ritual: (() => { try { return ritual() ?? null } catch { return null } })(),
      reciprocity: (() => { try { return reciprocity() ?? null } catch { return null } })(),
      majorEvent: (() => { try { return majorEvent() ?? null } catch { return null } })(),
      ostracism: (() => { try { return ostracism() ?? null } catch { return null } })(),
      legacy: (() => { try { return legacy() ?? null } catch { return null } })(),
      retired: (() => { try { return retired() || [] } catch { return [] } })(),
      boundary: (() => { try { return boundary() ?? null } catch { return null } })(),
      repair: (() => { try { return repair() ?? null } catch { return null } })(),
      integrated: (() => { try { return integrated() ?? null } catch { return null } })(),
      maintenance: (() => { try { return maintenance() ?? null } catch { return null } })(),
      updatedAt: state.updatedAt,
      // 输出通道那几个数在心情那边，人格自己算不出来——直接透出真值，缺就是 null（面板显示 —）
      affect: a ? {
        mood: a.mood, valence: a.valence, brevity: a.brevity, delayMs: a.delayMs,
        meme: a.meme, memeQuery: a.memeQuery, memeStyle: a.memeStyle, tone: a.tone,
        emotions: Array.isArray(a.emotions) ? a.emotions : [],
      } : null,
      now: {
        hex: f.hex || null,
        traits: f.traits || null,
        emotions: (f.emotions || []).map((e) => e.kind),
        ticks: h.ticks ?? 0,
        evidence: h.evidence ?? null,
        lastSlow: h.lastSlow ?? null,
      },
    }
  }

  const html = () => `<!doctype html><html lang="zh"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>人格</title>
<style>
:root{color-scheme:dark}
body{margin:0;font:14px/1.6 system-ui,-apple-system,"Segoe UI",sans-serif;background:#14161a;color:#e6e8ec}
main{max-width:820px;margin:0 auto;padding:24px 20px 64px}
h1{font-size:18px;margin:0 0 4px}h2{font-size:14px;color:#9aa4b2;margin:24px 0 8px;font-weight:500}
.card{background:#1b1e24;border:1px solid #272b33;border-radius:10px;padding:14px 16px;margin:10px 0}
.row{display:flex;gap:10px;flex-wrap:wrap;align-items:center}
label.mode{flex:1;min-width:220px;border:1px solid #2c313a;border-radius:8px;padding:10px 12px;cursor:pointer}
label.mode input{margin-right:6px}
.small{color:#9aa4b2;font-size:12px}
textarea{width:100%;min-height:110px;background:#12141a;color:#e6e8ec;border:1px solid #2c313a;border-radius:8px;padding:10px;font:inherit}
input[type=range]{width:100%}
button{background:#2b6cff;color:#fff;border:0;border-radius:8px;padding:9px 16px;font:inherit;cursor:pointer}
button.ghost{background:#232833;color:#cfd6e4}
.kv{display:grid;grid-template-columns:110px 1fr;gap:4px 12px}
.kv b{color:#9aa4b2;font-weight:500}
pre{white-space:pre-wrap;margin:0;font-size:12px;color:#b7c0cf}
.ok{color:#5ad18c}.bad{color:#ff7a7a}
</style></head><body><main>
<h1>人格</h1>
<div class="small">情绪由心情插件负责；这里只管“她是个什么样的人”。</div>

<h2>模式</h2>
<div class="card">
  <div class="row">
    <label class="mode"><input type="radio" name="mode" value="custom"><b>自定义 + 学习</b><div class="small">主人写的自述和旋钮先生效，证据随后慢慢调</div></label>
    <label class="mode"><input type="radio" name="mode" value="learn"><b>纯学习</b><div class="small">手写一律不生效，只按她自己的经历推</div></label>
  </div>
</div>

<h2>她说她是什么样的人（只在“自定义 + 学习”下生效）</h2>
<div class="card">
  <textarea id="self" placeholder="例：话不多，嘴硬心软；被人质疑会先顶一句，再自己反省。"></textarea>
  <div class="small" style="margin-top:8px">这段会原样进到她的上下文，优先级高于推断。</div>
  <div class="row" style="margin-top:10px">
    <button id="save2">保存</button>
    <button class="ghost" id="draftBtn">从我的经历生成草稿</button>
    <button class="ghost" id="revertBtn">撤回上一版</button>
    <span id="draftMsg" class="small"></span>
    <span id="msg2" class="small"></span>
  </div>
  <div id="draftUsed" class="small" style="margin-top:8px"></div>
</div>

<h2>三个旋钮</h2>
<div class="card">
  <div class="row"><div style="flex:1"><div>敏感度 sensitivity <span id="vs"></span></div><input id="sensitivity" type="range" min="0.5" max="2" step="0.05"></div></div>
  <div class="row"><div style="flex:1"><div>威胁增益 threatGain <span id="vt"></span></div><input id="threatGain" type="range" min="0.5" max="2" step="0.05"></div></div>
  <div class="row"><div style="flex:1"><div>底色 baselineMood <span id="vb"></span></div><input id="baselineMood" type="range" min="-0.2" max="0.2" step="0.01"></div></div>
</div>

<div class="row" style="margin-top:14px">
  <button id="save">保存</button>
  <button id="refresh" class="ghost">刷新读数</button>
  <span id="msg" class="small"></span>
</div>

<h2>她现在的样子</h2>
<div class="card"><div id="now" class="kv"></div></div>
<h2>六个器官</h2>
<div class="card"><div id="organs" class="kv"></div></div>
<h2>原始读数</h2>
<div class="card"><pre id="raw"></pre></div>
</main>
<script>
const $ = (id) => document.getElementById(id)
let st = null
function fmt(v){ return (v==null||Number.isNaN(v))?'—':Number(v).toFixed(2) }
function render(){
  document.querySelectorAll('input[name=mode]').forEach(r=>{ r.checked = r.value===st.mode })
  $('self').value = st.selfText || ''
  for (const k of ['sensitivity','threatGain','baselineMood']) {
    $(k).value = st.knobs[k] ?? (k==='baselineMood'?0:1)
    $('v'+k[0]).textContent = fmt($(k).value)
  }
  const n = st.now || {}
  const hex = n.hex || {}
  const a = st.affect || {}
  $('now').innerHTML = [
    '<b>模式</b><span>'+(st.mode==='custom'?'自定义 + 学习':'纯学习')+'</span>',
    // 这几项来自心情那边（人格自己不算这些数）：拿不到就是 —，不编
    '<b>句长 brevity</b><span>'+fmt(a.brevity)+'</span>',
    '<b>心情 mood</b><span>'+fmt(a.mood)+'</span>',
    '<b>语气 tone</b><span>'+(a.tone || '—')+'</span>',
    '<b>回复延迟</b><span>'+(a.delayMs==null?'—':Math.round(a.delayMs/1000)+' 秒')+'</span>',
    '<b>表情包倾向</b><span>'+fmt(a.meme)+'</span>',
    '<b>表情包情境</b><span>'+(a.memeQuery || '—')+'</span>',
    '<b>情绪标签</b><span>'+(((a.emotions&&a.emotions.length?a.emotions:n.emotions)||[]).join('、')||'—')+'</span>',
    '<b>拍数</b><span>'+(n.ticks??'—')+'</span>',
    '<b>证据</b><span>'+((n.evidence&&(n.evidence.n??JSON.stringify(n.evidence)))??'—')+'</span>',
  ].join('')
  const org = st.organs || {}
  const name = { str: '纹状体（想要）', tpj: '颞顶（读人）', ofc: '眶额（值不值）', acc: '前扣带（冲突）', mpfc: '内侧前额（自我）', pcc: '后扣带（连续）' }
  const rows = []
  for (const k of ['str', 'tpj', 'ofc', 'acc', 'mpfc', 'pcc']) {
    const o = org[k] || {}
    const parts = Object.entries(o).map(([kk, vv]) => kk + ' ' + fmt(vv)).join(' · ')
    rows.push('<b>' + (name[k] || k) + '</b><span>' + (parts || '—') + '</span>')
  }
  const box = $('organs')
  if (box) box.innerHTML = rows.join('')
  $('raw').textContent = JSON.stringify(st, null, 1)
}
async function load(){
  const r = await fetch('/persona/state'); st = await r.json(); render()
}
// 保存：文本框旁边那个和页面底部那个是同一个动作；Ctrl+S 也行
async function saveNow(){
  const mode = document.querySelector('input[name=mode]:checked').value
  const body = { mode, selfText: $('self').value, knobs: {
    sensitivity: +$('sensitivity').value, threatGain: +$('threatGain').value, baselineMood: +$('baselineMood').value } }
  const r = await fetch('/persona/save', { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify(body) })
  const j = await r.json()
  const msg = j.ok ? ('已保存 · ' + new Date().toLocaleTimeString('zh-CN')) : ('没存上：'+(j.error||''))
  for (const id of ['msg','msg2']) {
    const el = $(id); if (!el) continue
    el.textContent = msg
    el.className = 'small ' + (j.ok?'ok':'bad')
  }
  await load()
}
$('save').onclick = saveNow
$('save2').onclick = saveNow
$('self').addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key === 's') { e.preventDefault(); saveNow() }
})
$('refresh').onclick = load
for (const k of ['sensitivity','threatGain','baselineMood']) {
  $(k).addEventListener('input', () => { $('v'+k[0]).textContent = fmt($(k).value) })
}
// 自我草稿：只看不写；要写就按"保存"（那一步才是确认）
$('draftBtn').onclick = async () => {
  $('draftMsg').textContent = '生成中…'
  try {
    const r = await fetch('/persona/draft')
    const j = await r.json()
    if (j.empty) { $('draftMsg').textContent = j.note || '还没有可用的经历'; $('draftUsed').textContent = ''; return }
    $('self').value = j.draft || ''
    $('draftMsg').textContent = '用了 ' + (j.used || []).length + ' 条经历，语气估自 ' + (j.sampleCount || 0) + ' 条她自己的原话；觉得像就点"保存"'
    $('draftUsed').textContent = (j.used || []).map((u) => '· ' + u.text).join(' · ')
  } catch (e) { $('draftMsg').textContent = '生成失败：' + e.message }
}
$('revertBtn').onclick = async () => {
  try {
    const r = await fetch('/persona/draft/revert', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })
    const j = await r.json()
    if (!j.ok) { $('draftMsg').textContent = '没有可撤回的上一版'; return }
    $('self').value = j.selfText || ''
    $('draftMsg').textContent = '已撤回上一版'
    await load()
  } catch (e) { $('draftMsg').textContent = '撤回失败：' + e.message }
}
load()
</script></body></html>`

  function json(res, obj, code = 200) {
    res.statusCode = code
    res.setHeader('content-type', 'application/json; charset=utf-8')
    res.end(JSON.stringify(obj))
  }

  function readBody(req) {
    return new Promise((resolve) => {
      let raw = ''
      req.on('data', (c) => { raw += c; if (raw.length > 64_000) req.destroy() })
      req.on('end', () => { try { resolve(JSON.parse(raw || '{}')) } catch { resolve({}) } })
      req.on('error', () => resolve({}))
    })
  }

  function register(ctx) {
    const route = (method, path, handler) => {
      try { ctx.webServer?.register?.({ method, path, handler }) } catch { /* 没面板也能跑 */ }
    }
    route('GET', '/persona', async (req, res) => {
      res.setHeader('content-type', 'text/html; charset=utf-8')
      res.end(html())
    })
    route('GET', '/persona/state', async (req, res) => json(res, snapshot()))
    route('POST', '/persona/save', async (req, res) => {
      const body = await readBody(req)
      const mode = body.mode === 'learn' ? 'learn' : 'custom'
      state.mode = mode
      state.selfText = String(body.selfText ?? '').slice(0, 2000)
      state.knobs = {
        sensitivity: Number(body?.knobs?.sensitivity ?? state.knobs?.sensitivity ?? 1),
        threatGain: Number(body?.knobs?.threatGain ?? state.knobs?.threatGain ?? 1),
        baselineMood: Number(body?.knobs?.baselineMood ?? state.knobs?.baselineMood ?? 0),
      }
      const saved = save()
      if (mode === 'custom') applyKnobs()
      else resetKnobs()
      json(res, { ok: saved, mode: state.mode, selfText: state.selfText, knobs: state.knobs })
    })

    // 自我草稿：从她真经历里长出来。先给草稿，确认了才写 self——不自动覆盖。
    route('GET', '/persona/draft', async (req, res) => {
      let eps = (() => { try { return episodes() || [] } catch { return [] } })()
      // 缓存可能还没刷新（启动后才拉）：这里等一次真拉取，别把"还没加载"说成"没有经历"
      if (!eps.length) {
        try { await refreshEpisodes() } catch { /* 拉不到就按空处理 */ }
        eps = (() => { try { return episodes() || [] } catch { return [] } })()
      }
      let samples = []
      try { samples = await styleSamples() } catch { samples = [] }
      const d = draftSelf(eps, { max: 6, selfText: state.selfText, samples })
      lastDraft = { ...d, generatedAt: Date.now() }
      json(res, {
        ok: !d.empty,
        draft: d.text,
        used: d.used,
        style: d.style,
        sampleCount: Array.isArray(samples) ? samples.length : 0,
        samplePreview: (Array.isArray(samples) ? samples : []).slice(-3).map((x) => String(x?.text ?? x ?? '').slice(0, 30)),
        empty: Boolean(d.empty),
        note: d.note || '',
        currentSelf: state.selfText,
        generatedAt: lastDraft.generatedAt,
      })
    })

    // 采纳草稿（或面板里改过的版本）：写进 self，旧的那份留作可撤销
    route('POST', '/persona/draft/accept', async (req, res) => {
      let body = {}
      try { body = await readBody(req) } catch { body = {} }
      const text = String(body.text ?? lastDraft?.text ?? '').trim().slice(0, 2000)
      if (!text) return json(res, { ok: false, error: 'no-draft' })
      state.prevSelfText = state.selfText
      state.selfText = text
      if (state.mode !== 'learn') state.mode = 'custom'
      const saved = save()
      if (state.mode === 'custom') applyKnobs()
      json(res, { ok: saved, selfText: state.selfText, prev: state.prevSelfText, at: state.updatedAt })
    })

    // 反悔：把上一版换回来（两份互换，可来回）
    route('POST', '/persona/draft/revert', async (req, res) => {
      if (typeof state.prevSelfText !== 'string') return json(res, { ok: false, error: 'no-prev' })
      const cur = state.selfText
      state.selfText = state.prevSelfText
      state.prevSelfText = cur
      const saved = save()
      json(res, { ok: saved, selfText: state.selfText, prev: state.prevSelfText })
    })
  }

  function resetKnobs() {
    try { return setPersona({ threatGain: 1, baselineMood: 0, sensitivity: 1 }) } catch { return { ok: false } }
  }

  return { state, load: () => state, applyKnobs, extraText, snapshot, register, resetKnobs }
}
