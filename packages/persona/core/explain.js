// E11 解释风格：同一件事，往好里想还是往坏里想——取决于她当下的底子，不是随机。
// E12 怀旧：旧事带回来的暖或酸。

/**
 * @param {string} text 发生了什么（对方描述的坏事）
 * @param {object} reads 六器官读数
 * @returns {{ frame:'benign'|'threat', line:string|null }}
 */
export function explainStyle(text = '', reads = {}) {
  const t = String(text || '')
  const n = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0)
  const esteem = n((reads.mpfc || {}).esteem)
  const crisis = n((reads.pcc || {}).crisis)

  if (!t) return { frame: 'benign', line: null }
  // 崩着的时候不会往好里想：那叫自我欺骗
  if (crisis > 0.5) return { frame: 'threat', line: '这会儿看什么都是坏的' }
  if (esteem >= 0.6) return { frame: 'benign', line: '也不算太糟，至少没到那一步' }
  return { frame: 'threat', line: null }
}

/**
 * E12 怀旧：翻到 7 天前的旧事才叫怀旧；昨天的叫"刚刚"。
 * @param {Array<{at?:number, text?:string}>} episodes
 */
export function nostalgia(episodes = [], now = Date.now()) {
  const list = Array.isArray(episodes) ? episodes : []
  const DAY = 86400000
  const old = list.filter((e) => {
    const at = Number(e && (e.at ?? e.ts))
    return Number.isFinite(at) && now - at >= 7 * DAY
  })
  if (!old.length) return { nostalgic: false, line: null }
  const pick = old[old.length - 1]
  const text = String((pick && (pick.summary || pick.text)) || '').slice(0, 24)
  if (!text) return { nostalgic: false, line: null }
  return { nostalgic: true, line: `突然想起「${text}」，都过去这么久了` }
}
