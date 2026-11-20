// X02 节奏与语速：不是"感觉快慢"，是从她自己的句子里量出来的目标长度。
// 数据来源：panel.style（从她的样本里量出的平均句长、语气词率）。

/**
 * @param {{avgLen?:number, particleRate?:number, samples?:number}} style
 * @returns {{ maxChars:number|null, hint:string|null, because:string }}
 */
export function rhythm(style = {}) {
  const n = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0)
  const samples = n(style.samples)
  const avg = n(style.avgLen)

  // 没有样本：不给节奏指令，免得瞎编一个长度
  if (samples < 3 || avg <= 0) return { maxChars: null, hint: null, because: 'no-samples' }

  // 目标：比她自己平均句长略短一点（说话时人比写下来更短）
  const maxChars = Math.max(8, Math.min(60, Math.round(avg * 0.9)))
  const particle = n(style.particleRate)
  const hint = particle >= 0.3
    ? `一条别超过 ${maxChars} 字，语气词最多一个`
    : `一条别超过 ${maxChars} 字，别硬加语气词`
  return { maxChars, hint, because: 'measured' }
}
