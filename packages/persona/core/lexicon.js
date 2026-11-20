// X01 词汇与句式：她爱用什么语气词、不许用什么书面腔。
// 说明：中文没有分词库可用，硬切 n-gram 会切出「个就是」这种垃圾（上一版就翻过车）。
// 所以只统计**确实能数清**的东西：语气词用没用、用哪几个。

const PARTICLES = ['呗', '啦', '嘛', '呀', '哈', '咯', '喽', '诶', '哎', '哇']
export const BANNED_LIST = ['首先', '其次', '综上', '总之', '总而言之', '值得注意', '与此同时', '作为一个AI', '作为AI', '模型']

/**
 * @param {string[]} samples 她说过的话
 * @returns {{ particles:string[], banned:string[], hint:string|null, because:string }}
 */
export function lexicon(samples = []) {
  const list = Array.isArray(samples) ? samples.filter((x) => typeof x === 'string' && x.trim()) : []
  if (!list.length) return { particles: [], banned: BANNED_LIST.slice(), hint: null, because: 'no-samples' }

  const counts = new Map()
  for (const s of list) {
    for (const ch of String(s)) {
      if (PARTICLES.includes(ch)) counts.set(ch, (counts.get(ch) || 0) + 1)
    }
  }
  // 至少在两句里出现过才算她的习惯
  const particles = [...counts.entries()]
    .filter(([, n]) => n >= 2)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([w]) => w)

  if (!particles.length) {
    return { particles: [], banned: BANNED_LIST.slice(), hint: '她不太用语气词，别硬塞', because: 'no-particles' }
  }

  const hint = `她爱用的语气词：${particles.join('、')}（一条最多一个）；别用：${BANNED_LIST.slice(0, 3).join('、')}`
  return { particles, banned: BANNED_LIST.slice(), hint, because: 'measured' }
}
