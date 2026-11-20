// 三器一体：心情给"现在的底色"，记忆给"过去的证据"，人格给"她怎么处理"。
// 谁说了算：事实（记忆）> 人格底线 > 当下心情。心情能改语气，不能改事实。
const NEG = /(难过|委屈|心痛|生气|厌烦|失望|烦|累)/

/**
 * @param {object} input
 * @param {{emotions?:Array<{kind:string,intensity:number}>}} input.affect 心情侧读数
 * @param {Array<{text?:string, kind?:string, at?:number}>} input.recall 记忆里翻出来的东西
 * @param {{boundary?:{level:string,sharesPrivate:boolean}, values?:{bottomLine?:boolean}}} input.persona 人格侧状态
 * @returns {{ tone:'low'|'up'|'flat', cite:string|null, recallAllowed:boolean, line:string|null, because:string }}
 */
export function fuse(input = {}) {
  const emos = Array.isArray(input.affect && input.affect.emotions) ? input.affect.emotions : []
  const recall = Array.isArray(input.recall) ? input.recall.filter((x) => x && typeof x === 'object') : []
  const bd = (input.persona && input.persona.boundary) || {}

  const neg = emos.filter((e) => NEG.test(String(e.kind || ''))).reduce((s, e) => s + Number(e.intensity || 0), 0)
  const pos = emos.filter((e) => !NEG.test(String(e.kind || ''))).reduce((s, e) => s + Number(e.intensity || 0), 0)

  // 人格底线优先于心情：底线破了，再高兴也不笑
  if (input.persona && input.persona.values && input.persona.values.bottomLine) {
    return { tone: 'flat', cite: null, recallAllowed: false, line: '这事我不接，换个话题', because: 'bottom-line' }
  }
  // 不熟的人：心情再差也不翻旧账（旧事是熟人才有的特权）
  const recallAllowed = bd.level === 'familiar' || bd.level === 'close' || bd.level === undefined
  const tone = neg > pos + 0.05 ? 'low' : pos > neg + 0.05 ? 'up' : 'flat'

  // 心情低 + 记忆里有同类旧事：不是"又难过一次"，是"上次也这样"
  // 旧事是不是伤心的：看情绪词，也看记忆自带的好坏值（valence）
  const hurts = recall.filter((r) => {
    if (/(委屈|心痛|生气|失望|难过)/.test(String(r.kind || '') + String(r.text || ''))) return true
    const v = Number(r.valence)
    return Number.isFinite(v) && v < -0.2
  })
  if (tone === 'low' && hurts.length && recallAllowed) {
    const last = String(hurts[hurts.length - 1].text || hurts[hurts.length - 1].kind || '').slice(0, 18)
    return { tone, cite: last || null, recallAllowed, line: last ? `上次好像也这样：${last}` : null, because: 'mood+memory' }
  }
  // 心情好：翻点暖的，但别硬提旧账
  if (tone === 'up' && recallAllowed) {
    const warm = recall.find((r) => {
      const blob = String(r.text || '') + String(r.kind || '')
      // 伤心的旧事不许当暖的用（"说好陪我去海边"是失望，不是温柔）
      if (NEG.test(blob)) return false
      return /(开心|安心|感动|一起|陪我|煮饺子|笑)/.test(blob)
    })
    if (warm) {
      const t = String(warm.text || '').slice(0, 18)
      if (t) return { tone, cite: t, recallAllowed, line: `还记得${t}`, because: 'warm+memory' }
    }
  }
  return { tone, cite: null, recallAllowed, line: null, because: 'tone-only' }
}
