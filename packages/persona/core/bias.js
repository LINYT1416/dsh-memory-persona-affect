// B 层：进不了字面的读数，全部转成输出偏置（改语气/句长/延迟/表情包倾向），一个字都不显。
// 这样「全部读数都参与」和「不像仪表盘」能同时成立。
const cl = (v, a, b) => Math.max(a, Math.min(b, v))
const n = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0)

export function biasOf(reads = {}) {
  const r = reads || {}
  const acc = r.acc || {}, ofc = r.ofc || {}, str = r.str || {}, mpfc = r.mpfc || {}, tpj = r.tpj || {}, pcc = r.pcc || {}
  const d = { brevity: 0, warmth: 0, blunt: 0, delayMs: 0, meme: 0 }

  // 心里打架 / 知道自己错了 → 话更短（不是不说，是收）
  d.brevity += 0.18 * n(acc.conflict) + 0.22 * n(acc.error)
  // 腻了 → 话更短
  d.brevity += 0.15 * n(str.satiation)
  // 护短被挑起 / 被冒犯 → 更直
  d.blunt += 0.20 * n(tpj.offense) + 0.15 * n(mpfc.protecting)
  // 内疚、羞 → 少发表情、语气收
  d.meme -= 0.30 * (n(ofc.guilt) + n(ofc.shame))
  d.warmth -= 0.12 * (n(ofc.guilt) + n(ofc.shame))
  // 怀旧 / 被人接住 → 暖一点
  d.warmth += 0.15 * n(pcc.nostalgia) + 0.10 * n(ofc.warm)
  // 理想我和现实我差得远 → 说得少一点、热度低一点
  d.brevity += 0.18 * n(mpfc.idealGap)
  d.warmth -= 0.10 * n(mpfc.idealGap)
  // 认不出自己了 → 慢半拍、话更碎
  d.delayMs += 500 * n(pcc.crisis)
  d.brevity += 0.12 * n(pcc.crisis)
  // 觉得不公平 → 更直
  d.blunt += 0.22 * n(ofc.unfair)
  // 想要得厉害 → 回得快一点
  d.delayMs -= 250 * n(str.wanting)
  // 没把握读人 → 慢半拍
  d.delayMs += 400 * n(tpj.misread)

  return {
    brevity: cl(d.brevity, -0.3, 0.4),
    warmth: cl(d.warmth, -0.3, 0.3),
    blunt: cl(d.blunt, -0.2, 0.3),
    delayMs: Math.round(cl(d.delayMs, -1200, 1500)),
    meme: cl(d.meme, -0.4, 0.2),
  }
}
