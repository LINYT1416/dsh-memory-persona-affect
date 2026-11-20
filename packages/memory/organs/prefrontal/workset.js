// 工作集压缩：给"记忆四器官"用的上下文压缩，不是通用摘要。
//
// 为什么归前额叶：它本来就在做"这件值不值得记、先看哪个、压掉谁"。
// 为什么不是通用摘要：压缩后的东西必须仍然是**可召回的索引**——
//   丢的是"进上下文的字"，不是"记忆里的细节"。细节留在海马体原话里，靠指针回取。
//
// 输出五块（全部带指针）：
//   当前任务 / 未完成 / 关键实体与结论 / 可召回指针 / 情绪底色
//
// 抽取式，不用模型：可复现、可断言。这是真话——它不是人那种概括。

const CN_STOP = /[的了着过是在有没就都又也还很太会能要个些吗呢吧啊嗯哦呀嘛你我他她它们这那上下里外中几件次点样种步]/g

const MARK_UNFINISHED = /(还没|没做完|待会|待会儿|明天|下周|回头|等会|等我|记得|别忘了|需要|得去|要去做|TODO|待办)/
const MARK_DECISION = /(决定|定了|改成|就用|那就|定了|结论|确定|方案是|选)/
const MARK_TASK = /(现在|接下来|先|准备|开始|在处理|正在)/

const norm = (s) => String(s || '').replace(/\s+/g, ' ').trim()
const clip = (s, n) => (s.length <= n ? s : s.slice(0, n - 1) + '…')

// 粗估 token：中文按字算，英文按 4 字符算，不追求精确，只要同一套口径
export function estimateTokens(text) {
  const s = String(text || '')
  let cn = 0
  let other = 0
  for (const ch of s) {
    if (/[\u4e00-\u9fff]/.test(ch)) cn += 1
    else other += 1
  }
  return Math.ceil(cn / 1.5 + other / 4)
}

function sentences(text) {
  return norm(text)
    .split(/(?<=[。！？!?；;\n])/)
    .map((x) => x.trim())
    .filter((x) => x.length >= 6)
}

function entitiesOf(text) {
  const out = new Set()
  const s = String(text || '')
  for (const m of s.matchAll(/[「“"]([^」”"]{2,20})[」”"]/g)) out.add(m[1])
  for (const m of s.matchAll(/\b[A-Za-z][A-Za-z0-9_./-]{2,24}\b/g)) out.add(m[0])
  for (const m of s.matchAll(/\d+(?:\.\d+)?\s*(?:个|条|次|天|分钟|小时|块钱|元|%|ms|s)/g)) out.add(m[0].replace(/\s+/g, ''))
  return [...out].slice(0, 8)
}

function salienceOf(turn) {
  const s = norm(turn?.text)
  const base = Number(turn?.salience ?? 0.3)
  let x = base
  if (MARK_UNFINISHED.test(s)) x += 0.35
  if (MARK_DECISION.test(s)) x += 0.25
  if (MARK_TASK.test(s)) x += 0.15
  if (entitiesOf(s).length) x += 0.1
  if (s.length > 60) x += 0.05
  return Math.min(1, x)
}

/**
 * @param {Array<{role?:string,text:string,at?:number,episodeId?:string,salience?:number}>} turns
 * @param {{budgetTokens?:number, maxPointers?:number}} opts
 */
export function buildWorkingSet(turns = [], opts = {}) {
  const budget = Math.max(200, Number(opts.budgetTokens) || 900)
  const maxPointers = Math.max(1, Number(opts.maxPointers) || 8)

  const rows = turns
    .map((t, i) => ({
      i,
      role: t.role === 'assistant' ? '她' : '他',
      text: norm(t.text),
      episodeId: t.episodeId ? String(t.episodeId) : '',
      sal: salienceOf(t),
      at: Number(t.at) || 0,
    }))
    .filter((r) => r.text)

  // 越新越优先；同分按时间
  const ranked = rows.slice().sort((a, b) => (b.sal - a.sal) || (b.at - a.at) || (b.i - a.i))

  const task = []
  const todo = []
  const facts = []
  const pointers = []

  const seen = new Set()
  const pushUnique = (arr, s) => {
    const k = s.replace(/[，。；、\s]/g, '').slice(0, 40)
    if (seen.has(k)) return false
    seen.add(k)
    arr.push(s)
    return true
  }

  for (const r of ranked) {
    for (const s of sentences(r.text)) {
      if (task.length < 2 && MARK_TASK.test(s) && pushUnique(task, s)) continue
      if (todo.length < 5 && MARK_UNFINISHED.test(s) && pushUnique(todo, s)) continue
      if (facts.length < 8 && (MARK_DECISION.test(s) || entitiesOf(s).length) && pushUnique(facts, s)) continue
    }
    if (r.episodeId && pointers.length < maxPointers) {
      pointers.push({ id: r.episodeId, hint: clip(r.text, 28), sal: Number(r.sal.toFixed(2)) })
    }
  }

  const blocks = []
  if (task.length) blocks.push(['现在在做', task])
  if (todo.length) blocks.push(['还没做完', todo])
  if (facts.length) blocks.push(['关键结论', facts])
  if (pointers.length) blocks.push(['能回取的细节', pointers.map((p) => `${p.id}｜${p.hint}`)])

  const build = () => blocks
    .map(([title, items]) => `${title}：\n` + items.map((x) => `- ${x}`).join('\n'))
    .join('\n')

  // 预算：从最后一块开始挤（指针最没用就丢），一块都不许整块消掉主任务
  let text = build()
  let dropped = 0
  while (estimateTokens(text) > budget && blocks.length > 1) {
    const last = blocks[blocks.length - 1]
    if (last[1].length > 1) { last[1].pop(); dropped += 1 } else { blocks.pop(); dropped += 1 }
    text = build()
  }
  // 单块仍超预算：按行截断
  while (estimateTokens(text) > budget && text.length > 40) {
    text = text.slice(0, Math.max(40, Math.floor(text.length * 0.8)))
    dropped += 1
  }

  return {
    text: blocks.length ? `她的工作记忆（压缩）：\n${text}` : '',
    raw: blocks,
    kept: { task, todo, facts, pointers },
    tokens: estimateTokens(text),
    budget,
    dropped,
    turns: rows.length,
  }
}
