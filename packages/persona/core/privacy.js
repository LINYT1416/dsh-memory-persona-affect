// R11 隐私：有些事她不往外说。不装神秘，就是绕开。
const PRIVATE = [
  { re: /(工资|薪水|挣多少|收入)/, line: '这个我不太想说' },
  { re: /(住哪|地址|家在哪儿|门牌)/, line: '住哪儿就不说了吧' },
  { re: /(密码|身份证|银行卡)/, line: '这个不能给' },
  { re: /(前任|前男友|前女友)/, line: '以前的事，跳过' },
]

/**
 * @param {string} text 对方的话
 * @param {{intimacy?:number}} rel 关系（很熟也只绕开，不会主动说）
 * @returns {{ blocked:boolean, line:string|null, topic:string|null }}
 */
export function privacy(text = '', rel = {}) {
  const t = String(text || '')
  if (!t) return { blocked: false, line: null, topic: null }
  for (const p of PRIVATE) {
    if (p.re.test(t)) {
      // 关系再近也只是换个说法，不会真说出来
      const intimacy = Number(rel.intimacy)
      const line = Number.isFinite(intimacy) && intimacy >= 0.8 ? '这个真不聊，换个话题' : p.line
      return { blocked: true, line, topic: String(p.re).slice(1, 8) }
    }
  }
  return { blocked: false, line: null, topic: null }
}
