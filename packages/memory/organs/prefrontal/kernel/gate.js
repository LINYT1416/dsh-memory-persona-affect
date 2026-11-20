// #P0-10 规则维持 + #F3 编码准入（pf.gate）
// 规则是硬闸：全程不放开（R5）。gate 只回答"值不值得记"，不回答"重不重要"（那归杏仁核）。
import { negation } from './text.js'

const NOISE = /^(嗯+|啊+|哦+|噢+|好|好的|好吧|行|行吧|收到|明白|ok|okay|哈哈+|草|卧槽+)[\s!！。.，,~～…]*$/i
// 注：这条是「整句都是语气词」才算噪声；带内容的一律走下面的正常分支。
const DRAFT = /^(我先|我看看|让我|稍等|我想想)/

/** 用户显式约束："不要提…""别记…""不用管…" */
export function constraintOf(text) {
  const s = String(text ?? '')
  const m = s.match(/(?:不要|别|不用|不需要|不许)([^\n，。！？]{2,20})/)
  if (!m) return null
  return { text: m[1].trim(), at: Date.now() }
}

/** 硬闸：这条要不要被记 / 要不要被用。违反约束一律拒。 */
export function hardRule(text, ctx = {}) {
  const s = String(text ?? '')
  const rules = ctx.rules || []
  for (const r of rules) {
    if (r?.text && s.includes(r.text)) return { blocked: true, rule: r.text, why: `违反约束：${r.text}` }
  }
  return { blocked: false }
}

/**
 * shouldRemember：
 * - 噪声（纯语气词）不记
 * - 助手草稿不记（没真说出口）
 * - 明确"别记"的不记
 * - 其余放行；depth 给个粗档（0 不记 / 1 只落原文 / 2 建索引）
 */
export function shouldRemember(text, ctx = {}) {
  const s = String(text ?? '').trim()
  if (!s) return { keep: false, depth: 0, reason: '空' }
  if (NOISE.test(s)) return { keep: false, depth: 0, reason: '噪声' }
  // 用户当场说"这个别记"：拦的是这条，不需要调用方额外传 rules。
  // 但"别记错/别记混/别记漏/别记成/别记反"是**纠正**（后面往往跟着真信息），不是"别记"，
  // 以前一个裸的 /别记/ 会把「别记错了，我住威海不是烟台」整句丢掉。这里排除纠正语。
  if (/(?:别|不要|不用)(?:记|存|留)(?![错混漏反岔成])/.test(s)) {
    return { keep: false, depth: 0, reason: '用户说别记' }
  }
  if (DRAFT.test(s) && ctx.role !== 'user') return { keep: false, depth: 0, reason: '助手草稿' }
  const hard = hardRule(s, ctx)
  if (hard.blocked) return { keep: false, depth: 0, reason: hard.why }
  const n = negation(s)
  if (n?.strong && s.length < 12) return { keep: true, depth: 1, reason: '短否定，只落原文' }
  return { keep: true, depth: 2, reason: '正常' }
}
