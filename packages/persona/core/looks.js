// A01 外表 / A02 音色 / A03 姿态——主人给的设定，不是推断出来的。
// 聊天记录里取不到这三样，所以只接受手写，且优先于任何学习结果。
export const LOOKS = {
  appearance: '黑头发散在肩上，白白净净，眼睛炯炯有神、黑得发亮，阳光打在身上像个天使',
  voice: '声音偏软偏高',
  posture: '常年挂着耳机，走路会蹦蹦跳跳',
  vibe: '可可爱爱，像个小蛋糕',
}

// 这三条怎么影响输出（写清楚，别悄悄改）：
// - 声音偏软偏高 → 语气更暖一点（warmth +）
// - 走路蹦跳、常年挂耳机 → 反应快半拍（delayMs 略短）
// - 外表/氛围不进措辞，只供生图与仪表页展示（不去描述自己长什么样）
export function looksBias(looks = LOOKS) {
  const soft = /软|偏高|甜/.test(String(looks.voice || ''))
  const bouncy = /蹦|跳|耳机/.test(String(looks.posture || ''))
  return {
    warmth: soft ? 0.08 : 0,
    delayMs: bouncy ? -120 : 0,
  }
}

export function looksLine(looks = LOOKS) {
  const parts = [looks.appearance, looks.voice, looks.posture].filter(Boolean)
  return parts.length ? parts.join('；') : ''
}
