// X01 词汇句式 / X02 语速 / X03 语气标点：从主人写的自述里量出来，而不是拍脑袋。
// 输入只有"她自己认的样子"那段文本，所以量的是风格，不是内容。
const PARTICLES = ['呗', '啦', '嘛', '呀', '哦', '吧', '啊', '嗯', '唉', '诶']

export function extractStyle(text) {
  const raw = String(text || '').trim()
  if (!raw) return null
  // 她自己的口吻：优先取 "- " 开头的例句（那才是她打字的样子），没有才退回全文
  const samples = raw.split('\n').map(l => l.trim()).filter(l => l.startsWith('- ')).map(l => l.slice(2).trim())
  const s = samples.length ? samples.join('\n') : raw
  const sentences = s.split(/[。！？!?\n]+/).map(x => x.trim()).filter(Boolean)
  const chars = s.replace(/\s/g, '').length
  const avgLen = sentences.length ? +(chars / sentences.length).toFixed(2) : 0
  const count = (re) => (s.match(re) || []).length
  const q = count(/[？?]/g), ex = count(/[！!]/g), ell = count(/…|\.{3}/g)
  const per = Math.max(1, sentences.length)
  const particles = {}
  for (const p of PARTICLES) { const n = count(new RegExp(p, 'g')); if (n) particles[p] = n }
  return {
    sentences: sentences.length,
    chars,
    avgLen,
    questionRate: +(q / per).toFixed(3),
    exclaimRate: +(ex / per).toFixed(3),
    ellipsisRate: +(ell / per).toFixed(3),
    particles,
    particleRate: +(Object.values(particles).reduce((a, b) => a + b, 0) / per).toFixed(3),
  }
}

// 风格 → 输出偏置：句子长短、敢不敢用问句、敢不敢用感叹号、口头语密度
export function styleBias(st) {
  if (!st) return { brevity: 0, warmth: 0, blunt: 0 }
  const brevity = st.avgLen <= 18 ? 0.15 : st.avgLen >= 34 ? -0.15 : 0
  const warmth = Math.min(0.2, st.particleRate * 0.15)
  const blunt = st.exclaimRate >= 0.25 ? 0.1 : 0
  return { brevity, warmth, blunt }
}

// 自述 → 偏置：人设一改，行为就跟着改（这是底层逻辑，不靠人催）
export function selfBias(text, looks = {}) {
  const s = extractStyle(text)
  if (!s) return { brevity: 0, warmth: Number(looks.warmth) || 0, blunt: 0, delayMs: Number(looks.delayMs) || 0 }
  const b = styleBias(s)
  return {
    brevity: Number(b.brevity) || 0,
    warmth: (Number(b.warmth) || 0) + (Number(looks.warmth) || 0),
    blunt: Number(b.blunt) || 0,
    delayMs: Number(looks.delayMs) || 0,
  }
}

// 人设里写了、但实际行为没做到的那几条，抽成一句提示挂在注入末尾。
// 只认人设里明确写了的，不自己加戏。
export function selfHints(text) {
  const s = String(text || '')
  const out = []
  if (/语气词/.test(s)) out.push('说话带点语气词（呗、啦、嘛、呀），但一句话里别超过一个')
  if (/1[～~-]3\s*句|一条\s*1/.test(s)) out.push('一条最多三句，能一句说完就别说两句')
  if (/别每句感叹号|不要每句感叹号/.test(s)) out.push('别每句都感叹号')
  return out
}
