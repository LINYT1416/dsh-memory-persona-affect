// 共用数学与语用特征。六个器官都用这一份，不各写各的。

export const VERSION = '2.0.0'

export const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v)
export const lerp = (a, b, t) => a + (b - a) * clamp(t, 0, 1)
export const decay = (dtMs, tauMin) => Math.exp(-Math.max(0, dtMs) / Math.max(1e-6, tauMin * 60_000))
export const mean = (xs) => (xs.length ? xs.reduce((s, v) => s + v, 0) / xs.length : 0)

export function hash(str) {
  let h = 2166136261
  const s = String(str)
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return (h >>> 0).toString(36)
}

export const hourOf = (t) => new Date(t).getHours()
export const isNight = (t) => {
  const h = hourOf(t)
  return h >= 23 || h < 6
}

/** 语用特征：全转成 0/1，方便算 */
export function features(text) {
  const t = String(text || '')
  const b = (x) => (x ? 1 : 0)
  return {
    len: [...t].length,
    cold: b(/随便|哦$|嗯$|行了|懒得|无语|呵呵|关我什么事|闭嘴|别烦|不想聊|一边去|爱咋咋/.test(t)),
    command: b(/^(快|赶紧|别|给我|去|滚)/.test(t)),
    neg: b(/[不没别]/.test(t)),
    warm: b(/哈|嘿|喜欢|谢|乖|爱你|想你|抱|辛苦|麻烦你|多谢/.test(t)),
    question: b(/[?？]/.test(t)),
    praise: b(/厉害|好看|棒|佩服|牛|不错/.test(t)),
    complaint: b(/烦死|累死|气死|受不了|崩了|难受|憋屈|好累|好烦|加班|顶不住|熬不住|撑不住/.test(t)),
    selfRef: b(/我|自己/.test(t)),
    otherRef: b(/你|他|她/.test(t)),
    uncertain: b(/也许|可能|大概|不确定|看情况|再说/.test(t)),
    sarcasm: b(/呵呵|就这|你厉害|行吧|笑死|阴阳/.test(t)),
    exclaim: (t.match(/[!！]/g) || []).length,
  }
}

/** 习惯的线索：粗分类，不认全文。人记的是"这类事"，不是每个字 */
export function cueOf(text) {
  const t = String(text || '')
  if (/^(在吗|在么|在不在|人呢)/.test(t)) return 'ping'
  if (/(累|困|烦|难受|不行了|撑不住)/.test(t)) return 'vent'
  if (/^(快|赶紧|别|给我|去)/.test(t)) return 'cmd'
  if (/(哈|嘿|笑死|乐死|草)/.test(t)) return 'joke'
  if (/^(早|晚安|睡了|去睡|我先)/.test(t)) return 'greet'
  if (/[?？]/.test(t)) return 'ask'
  return 'talk'
}

/** 讽刺/阴阳的粗判：真人的读法本来就不准，这里允许误判 */
export function smellsOff(text) {
  const t = String(text || '')
  if (/呵呵|就这|你厉害|行吧你|随便你|你开心就好/.test(t)) return 1
  if (/[?？].*[?？]/.test(t)) return 0.6
  if (/^(哦|嗯|行)$/.test(t.trim())) return 0.8
  return 0
}
