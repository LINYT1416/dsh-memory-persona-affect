// 仪表页：把"她此刻在想什么"拆成可看的多维数据。
// 只读快照，不改任何状态；每次请求现算。

import { clamp } from './consts.js'

const pct = (x) => Math.round(clamp(x, 0, 1) * 100)

// 心情带：把 engine.state.mood（-1..1，0.1 是底色）切成可读的档位。
// 单独导出成纯函数，测试可以直接断言"同一个 mood 永远得到同一个词"。
// 为什么要有它：headline 以前只有"主情绪 强度"，而主情绪长期是同一个负性词，
// 于是 /affect/live 连着几天都是"心痛 0.24"，页面看起来像死的。
const MOOD_BANDS = [
  { min: 0.55, word: '心情挺好', tone: 'good' },
  { min: 0.30, word: '挺松的', tone: 'good' },
  { min: 0.10, word: '还行', tone: 'good' },
  { min: -0.10, word: '平平的', tone: 'flat' },
  { min: -0.30, word: '有点低', tone: 'low' },
  { min: -0.50, word: '闷闷的', tone: 'low' },
  { min: -2, word: '沉下去了', tone: 'bad' },
]
export function moodBand(mood) {
  const v = Number(mood)
  const m = Number.isFinite(v) ? v : 0
  return MOOD_BANDS.find((b) => m >= b.min) ?? MOOD_BANDS[MOOD_BANDS.length - 1]
}

export function summarize(engine) {
  const f = engine.read()
  if (!f) engine.tick()
  const g = engine.read()
  const organs = engine.organs
  const hyp = organs.hypothalamus.read()
  const ins = organs.insula.read()
  const pf = organs.pfc.read()
  const soc = organs.social.read()
  const hip = organs.hippocampus.read()
  const dmn = organs.dmn.read()
  const att = organs.attention.read()
  const cur = organs.curve.read()
  const io = organs.io.read()

  const main = g.emotions?.[0]
  const mood = engine.state.mood
  const band = moodBand(mood)
  // 两维一起报：主情绪（这一刻发生的事）+ 心情带（这几小时的底子）。
  // 只报主情绪时，"心痛"会连着好几天；只报心情带又看不出刚发生了什么。
  const label = main ? `${main.kind} ${main.intensity.toFixed(2)}` : band.word
  const headline = main ? `${main.kind}｜${band.word}` : band.word

  // 器官贡献 → 0..100 的刻度。换算写死在这里（0.02 的评价值挪动 = 5 分），
  // 好让"今天这根条多长"跨帧可比、也能被测试断言。
  const delta = g.organDelta ?? {}
  const rawDelta = (id) => Number(Number(delta[id] ?? 0).toFixed(3))
  const contrib = (id) => pct(clamp(rawDelta(id) * 2.5, 0, 1))
  // 器官声音一条：v 和文案必须同源。v=0 时只能说"没出力/没出声"，
  // 不许说"想起了旧事""绷着"这种肯定句（值和话打架，读的人只会觉得在编）。
  const voiceText = (id, loud, quiet, organ) => ({
    organ,
    text: contrib(id) > 0 ? loud : quiet,
    v: contrib(id),
    contrib: rawDelta(id),
    source: `organDelta.${id}`,
  })

  const memBridge = engine.bridgeStatus?.() ?? null
  return {
    at: new Date().toISOString(),
    tick: engine.state.ticks,
    headline,
    mood: {
      value: Number(mood.toFixed(3)),
      // 0..100，50 是中点；量纲不是"百分比"，是"好到坏的位置"。
      // 以前这个字段没有区间说明，前端和测试都容易把它当成 0..1 直接比。
      pct: pct((mood + 1) / 2),
      range: [-1, 1],
      mid: 50,
      label,
      band: band.word,
      tone: band.tone,
      // 底子：回到底色还要多久的量级提示（小时），读 engine.persona.tauMoodH 同一把尺子。
      tauHours: Number(engine.persona?.tauMoodH ?? 0),
    },
    valence: Number((g.valence ?? 0).toFixed(3)),
    arousal: pct(g.arousal ?? 0),
    emotions: (g.emotions ?? []).map(e => ({ kind: e.kind, intensity: pct(e.intensity) })),
    // 同时在场的几个情绪（有主次），不是只给一个标签
    coexist: (g.emotions ?? []).map((e, i) => ({
      kind: e.kind, intensity: pct(e.intensity), role: i === 0 ? '主' : i === 1 ? '次' : '余',
    })),
    // 器官各自的声音：v 是**它这一帧对评价的实际贡献**（见 fuse.organDelta），
    // 不是它的"读数"。读数高但这一帧什么也没做的器官，在这里就该是安静的；
    // 反过来，社会层读数平平、却把 coping 抬了 0.12，它就该有声音。
    // 以前社会层写死读 otherFelt，没人难受时恒 0，看起来像"社会层常年不动"。
    organVoice: [
      // 一条规矩：贡献是 0 的器官，文案不许说"发生了什么事"。
      // 以前海马这条会一边显示 0 分、一边写"想起了旧事"——值 0 和肯定句打架，
      // 读的人只会觉得仪表页在编。现在先看 v，再决定说强话还是说"没出声"。
      voiceText('insula', (ins.felt?.qualities ?? []).join('') || '有一点感觉', '没感觉', '岛叶'),
      voiceText('amygdala', (g.signals?.sensMax ?? 1) > 1.25 ? '一点动静就惊' : '还稳', '没被点着', '杏仁核'),
      voiceText('pfc', (pf.load ?? 0) > 0.5 ? '同时顾着好几件事' : (pf.cap ?? 1) < 0.4 ? '转不太动' : '还转得动', '没插手', '前额叶'),
      voiceText('social', (soc.otherFelt ?? 0) > 0.4 ? '也替他难受' : (soc.comfort ?? 0) > 0.4 ? '被安抚到一点' : '分得清是谁的事', '没出声', '社会层'),
      voiceText('hippocampus', g.memoryEcho?.hits?.length ? '想起了旧事' : '没翻到相似的',
        g.memoryEcho?.hits?.length ? '翻到旧事，但没拽动' : '没翻到相似的', '海马'),
      voiceText('brainstem', (g.signals?.arousal ?? 0) > 0.5 ? '提起来了' : '松的', '没动静', '脑干'),
      voiceText('neuromod', (g.signals?.da ?? 0) > 0.6 ? '有点想要点什么' : '平', '没调', '调质'),
      voiceText('endocrine', (g.signals?.cortisol ?? 0) > 0.5 ? '绷着' : (g.signals?.oxytocin ?? 0) > 0.6 ? '对他软了一点' : '平', '没动', '内分泌'),
    ],
    target: g.target ?? '这件事',
    body: {
      hr: Math.round(hyp.body?.hr ?? 0),
      breath: Math.round(hyp.body?.breath ?? 0),
      tension: pct(hyp.body?.tension ?? 0),
      pain: pct(hyp.body?.pain ?? 0),
      temp: Number((hyp.body?.temp ?? 0).toFixed(2)),
      qualities: ins.felt?.qualities ?? [],
      location: ins.felt?.location ?? '',
      felt: pct(ins.felt?.intensity ?? 0),
    },
    // 十个维度：v 一律是 0..100 的"填满度"，raw 是它读的那一个字段的原始值，
    // range 是 raw 的定义域，mid 是"中性"落在条上的位置（只有有符号的量需要）。
    // 以前"心情"是 (mood+1)/2 的百分比，别的都是 0..1 直接乘 100 —— 混在一起没法比较，
    // 也没人知道 55 到底是"偏正"还是"一半"。现在每个维度都写明它从哪来。
    dimensions: [
      { key: '心情', v: pct((mood + 1) / 2), raw: Number(mood.toFixed(3)), range: [-1, 1], mid: 50, source: 'engine.state.mood', note: mood >= 0 ? '偏正' : '偏负' },
      { key: '唤醒', v: pct(g.arousal ?? 0), raw: Number((g.arousal ?? 0).toFixed(3)), range: [0, 1], mid: 0, source: 'fused.arousal', note: (g.arousal ?? 0) > 0.6 ? '绷着' : '松' },
      { key: '体内感', v: pct(ins.felt?.intensity ?? 0), raw: Number((ins.felt?.intensity ?? 0).toFixed(3)), range: [0, 1], mid: 0, source: 'insula.felt.intensity', note: (ins.felt?.qualities ?? []).join('') || '没感觉' },
      { key: '理性余量', v: pct(pf.bandwidth ?? 0), raw: Number((pf.bandwidth ?? 0).toFixed(3)), range: [0, 1], mid: 0, source: 'pfc.bandwidth', note: (pf.bandwidth ?? 0) < 0.25 ? '快撑不住' : '还在' },
      { key: '忍住多少', v: pct(pf.display?.mask ?? 0), raw: Number((pf.display?.mask ?? 0).toFixed(3)), range: [0, 1], mid: 0, source: 'pfc.display.mask', note: `泄漏 ${pct(pf.display?.leakRisk ?? 0)}` },
      { key: '戒备', v: pct(soc.trust != null ? 1 - soc.trust : 0.4), raw: Number((soc.trust != null ? 1 - soc.trust : 0.4).toFixed(3)), range: [0, 1], mid: 0, source: '1 - social.trust', note: soc.attachment },
      { key: '社交余量', v: pct(1 - (hyp.needs?.contact ?? 0)), raw: Number((1 - (hyp.needs?.contact ?? 0)).toFixed(3)), range: [0, 1], mid: 0, source: '1 - hypothalamus.needs.contact', note: (hyp.needs?.contact ?? 0) > 0.6 ? '想找人' : '够用' },
      { key: '专注', v: pct(att.focus ?? 0), raw: Number((att.focus ?? 0).toFixed(3)), range: [0, 1], mid: 0, source: 'attention.focus', note: `窄化 ${pct(att.narrowing ?? 0)}` },
      { key: '疲惫', v: pct(hyp.sleepDebt ?? 0), raw: Number((hyp.sleepDebt ?? 0).toFixed(3)), range: [0, 1], mid: 0, source: 'hypothalamus.sleepDebt', note: `睡债 ${pct(hyp.sleepDebt ?? 0)}` },
      { key: '饥饿', v: pct(hyp.needs?.hunger ?? 0), raw: Number((hyp.needs?.hunger ?? 0).toFixed(3)), range: [0, 1], mid: 0, source: 'hypothalamus.needs.hunger', note: (hyp.needs?.hunger ?? 0) > 0.7 ? '饿' : '还行' },
    ],
    mind: {
      wander: pct(dmn.mindWander ?? 0),
      rumination: pct(dmn.rumination ?? 0),
      socialImagining: pct(dmn.socialImagining ?? 0),
      stuck: pct(att.sticky ?? 0),
      craving: pct(ins.craving ?? 0),
    },
    // mind 的五项都是 0..100 的"程度"，raw 是 0..1 的原值，来源逐个写明。
    // 以前这五项和 dimensions 混着看，没人分得清 40 是 0.4 还是 40%。
    mindRaw: {
      wander: Number((dmn.mindWander ?? 0).toFixed(3)),
      rumination: Number((dmn.rumination ?? 0).toFixed(3)),
      socialImagining: Number((dmn.socialImagining ?? 0).toFixed(3)),
      stuck: Number((att.sticky ?? 0).toFixed(3)),
      craving: Number((ins.craving ?? 0).toFixed(3)),
    },
    mindSource: {
      wander: 'dmn.mindWander', rumination: 'dmn.rumination', socialImagining: 'dmn.socialImagining',
      stuck: 'attention.sticky', craving: 'insula.craving',
    },
    social: {
      trust: pct(soc.trust ?? 0),
      socialPain: pct(soc.socialPain ?? 0),
      attachment: soc.attachment ?? 'secure',
      ledger: soc.ledgerOpen ?? 0,
      // 记仇：关系账本的净重（0..1）。和 ledger（"还没清的笔数"）分开：
      // 一笔账清了不代表这事没留下；grudge 才会跟着 48 小时半衰慢慢淡。
      grudge: Number(clamp(Number(g.signals?.grudges ?? 0), 0, 1).toFixed(3)),
      contagion: pct(soc.contagionOut ?? 0),
    },
    needs: {
      hunger: pct(hyp.needs?.hunger ?? 0),
      sleep: pct(hyp.needs?.sleep ?? 0),
      contact: pct(hyp.needs?.contact ?? 0),
      control: pct(hyp.needs?.control ?? 0),
    },
    cycle: hyp.cycle ?? null,
    memory: {
      count: hip.count ?? 0,
      // 刚想起：优先用这一拍真的从记忆里想起来的头一条（memoryEcho），
      // 没有才退回心情自己的"本地情绪片段"。以前只读 hip.recall，
      // 而它每拍先被清成 null、回填的兜底对象又没有 brief —— 所以永远是 —。
      recall: (g.memoryEcho?.hits?.[0]?.brief) || (hip.recall && hip.recall.hit ? hip.recall.brief : null),
      recallSource: g.memoryEcho?.hits?.length ? 'memory' : (hip.recall?.hit ? 'local' : null),
      schemas: ((g.memorySchemas && g.memorySchemas.length)
        ? g.memorySchemas
        : (hip.schemas ?? []).map(s => s.rule)).slice(0, 3),
      echo: g.memoryEcho?.hits?.map(h => h.brief) ?? null,
      recent: (g.memoryRecent ?? []).map(x => x.brief),
      organs: memBridge,
      schemaDebug: g.memorySchemaDebug ?? memBridge?.schemaDebug?.() ?? null,
      debug: engine.debugRecall?.(engine.lastUserText ?? '') ?? null,
    },
    curve: { phase: cur.phase, refractory: !!cur.refractory, intensity: pct(cur.intensity ?? 0) },
    output: {
      tone: pf.display?.toneShift ?? 'normal',
      brevity: pct(io.brevity ?? 0),
      delaySec: Math.round((io.replyDelayMs ?? 0) / 1000),
      meme: pct(io.memeTendency ?? 0),
    },
    trace: (engine.trace ?? []).slice(-30).map(t => ({ tick: t.txId, mood: t.mood, valence: t.valence, emotion: t.emotion, error: t.error || null })),
  }
}

const bar = (label, v, note = '') => `
  <div class="row">
    <div class="k">${label}</div>
    <div class="track"><i style="width:${v}%"></i></div>
    <div class="v">${v}${note ? ` <em>${note}</em>` : ''}</div>
  </div>`

export function dashboardHtml() {
  return `<!doctype html>
<html lang="zh">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>她的此刻</title>
<style>
:root{--bg:#0d1117;--card:#161b22;--line:#232b36;--fg:#e6edf3;--dim:#8b949e;--acc:#7aa2f7;--warm:#f7c76b;--bad:#f7768e;--ok:#9ece6a}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--fg);font:14px/1.6 -apple-system,"Segoe UI","Microsoft YaHei",sans-serif}
header{padding:18px 22px 8px}
h1{font-size:18px;margin:0 0 4px}
.sub{color:var(--dim);font-size:12px}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:12px;padding:12px 22px 28px}
.card{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:14px 16px}
.card h2{font-size:13px;margin:0 0 10px;color:var(--dim);font-weight:600;letter-spacing:.5px}
.row{display:flex;align-items:center;gap:8px;margin:6px 0}
.k{width:78px;color:var(--dim);font-size:12px;flex:none}
.track{flex:1;height:8px;background:#1f2732;border-radius:6px;overflow:hidden}
.track i{display:block;height:100%;background:linear-gradient(90deg,#3d59a1,var(--acc));border-radius:6px}
.v{width:86px;text-align:right;font-variant-numeric:tabular-nums;font-size:12px}
.v em{color:var(--dim);font-style:normal}
.big{font-size:26px;font-weight:700}
.pill{display:inline-block;padding:2px 10px;border-radius:999px;background:#1f2732;color:var(--dim);font-size:12px;margin-right:6px}
.pill.on{background:#22303f;color:var(--warm)}
.kv{display:flex;justify-content:space-between;padding:3px 0;font-size:13px}
.kv span:first-child{color:var(--dim)}
#spark{width:100%;height:56px;display:block}
.err{color:var(--bad)}
</style>
</head>
<body>
<header>
  <h1>她此刻</h1>
  <div class="sub" id="head">加载中…</div>
</header>
<div class="grid">
  <div class="card"><h2>概括</h2>
    <div class="big" id="label">—</div>
    <div class="sub" id="at"></div>
    <div style="margin-top:8px" id="emos"></div>
    <svg id="spark" viewBox="0 0 300 56" preserveAspectRatio="none"></svg>
  </div>
  <div class="card"><h2>十个维度</h2><div id="dims"></div></div>
  <div class="card"><h2>同时在场</h2><div id="coexist"></div></div>
  <div class="card"><h2>器官各自的声音（这一帧改了多少评价）</h2><div id="voice"></div></div>
  <div class="card"><h2>身体</h2><div id="body"></div></div>
  <div class="card"><h2>脑子里在转什么</h2><div id="mind"></div></div>
  <div class="card"><h2>关系</h2><div id="social"></div></div>
  <div class="card"><h2>需求 / 周期</h2><div id="needs"></div></div>
  <div class="card"><h2>记忆</h2><div id="memory"></div></div>
  <div class="card"><h2>表达倾向</h2><div id="output"></div></div>
</div>
<script>
const $ = (id) => document.getElementById(id)
const bar = (k, v, note) => '<div class="row"><div class="k">' + k + '</div><div class="track"><i style="width:' + v + '%"></i></div><div class="v">' + v + (note ? ' <em>' + note + '</em>' : '') + '</div></div>'
const kv = (k, v) => '<div class="kv"><span>' + k + '</span><span>' + v + '</span></div>'

async function tick(){
  try{
    const r = await fetch('/affect/live', {cache:'no-store'})
    const d = await r.json()
    $('head').textContent = '第 ' + d.tick + ' 拍 · ' + d.at.replace('T',' ').slice(0,19)
    $('label').textContent = d.headline
    $('at').textContent = '对象：' + d.target + ' · 心情带 ' + d.mood.band + ' · 效价 ' + d.valence + ' · 唤醒 ' + d.arousal
    $('emos').innerHTML = d.emotions.length ? d.emotions.map(e => '<span class="pill on">' + e.kind + ' ' + e.intensity + '</span>').join('') : '<span class="pill">没有明显情绪</span>'
    $('dims').innerHTML = d.dimensions.map(x => bar(x.key, x.v, x.note)).join('')
    $('coexist').innerHTML = (d.coexist && d.coexist.length)
      ? d.coexist.map(e => bar(e.kind + '（' + e.role + '）', e.intensity)).join('')
      : '<div class="row">这会儿没有明显情绪</div>'
    $('voice').innerHTML = (d.organVoice || []).map(v =>
      '<div class="row"><div class="k">' + v.organ + '</div><div class="track"><i style="width:' + v.v + '%"></i></div><div class="v">' + v.v + '</div></div>'
      + '<div class="sub" style="margin:-4px 0 6px 86px">' + v.text + '</div>').join('')
    $('body').innerHTML = kv('心率', d.body.hr) + kv('呼吸', d.body.breath) + kv('紧张', d.body.tension + '%') + kv('疼', d.body.pain + '%') + kv('体温感', d.body.temp) + kv('质地', (d.body.qualities.join('、') || '—') + (d.body.location ? ' @' + d.body.location : ''))
    $('mind').innerHTML = bar('走神', d.mind.wander) + bar('反刍', d.mind.rumination) + bar('想他', d.mind.socialImagining) + bar('念头黏住', d.mind.stuck) + bar('渴求', d.mind.craving)
    $('social').innerHTML = bar('信任', d.social.trust) + bar('被晾的痛', d.social.socialPain) + kv('依恋', d.social.attachment) + kv('没清的事', d.social.ledger) + kv('情绪外溢', d.social.contagion + '%')
    $('needs').innerHTML = bar('饿', d.needs.hunger) + bar('困', d.needs.sleep) + bar('想联系人', d.needs.contact) + bar('想掌控', d.needs.control) + kv('周期', d.cycle && d.cycle.on ? ('第 ' + d.cycle.day + ' 天 · ' + (d.cycle.phase || '平常')) : '关')
    $('memory').innerHTML = kv('情绪情景', d.memory.count) + kv('刚想起', d.memory.recall || '—') + kv('记忆回声', (d.memory.echo || []).join(' / ') || '—') + kv('图式', d.memory.schemas.join(' / ') || '—')
    $('output').innerHTML = kv('语气', d.output.tone) + bar('话变短', d.output.brevity) + kv('回复延迟', d.output.delaySec + ' 秒') + bar('表情包倾向', d.output.meme) + kv('曲线', d.curve.phase + (d.curve.refractory ? ' · 不应期' : ''))
    drawSpark(d.trace)
  }catch(e){ $('head').textContent = '读取失败：' + e.message }
}

function drawSpark(trace){
  const pts = trace.filter(t => typeof t.mood === 'number')
  if(pts.length < 2){ $('spark').innerHTML = ''; return }
  const w = 300, h = 56, ys = pts.map(p => (1 - (p.mood + 1) / 2) * h)
  const path = ys.map((y,i) => (i ? 'L' : 'M') + (i * w / (ys.length - 1)).toFixed(1) + ' ' + y.toFixed(1)).join(' ')
  $('spark').innerHTML = '<path d="' + path + '" fill="none" stroke="#7aa2f7" stroke-width="2"/>' + '<line x1="0" y1="28" x2="300" y2="28" stroke="#232b36"/>'
}

tick(); setInterval(tick, 2000)
</script>
</body></html>`
}

