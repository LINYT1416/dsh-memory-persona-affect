// V03 内疚 / V04 羞耻 / V05 骄傲：这三样是"关于自己"的情绪，和"被伤到"不是一回事。
// 心情侧只产出 心痛/委屈/生气/安心 这一套，认不出这三样——所以在这儿按事件判。

/**
 * @param {string} text 对方这条说了什么
 * @param {{hurts?:number}} rel 关系账本（有过节，自责才会变成内疚）
 * @param {{done?:number, failed?:number}} goals 她答应过的事
 * @returns {{ kind:'guilt'|'shame'|'pride'|null, line:string|null, because:string }}
 */
export function socialEmotion(text = '', rel = {}, goals = {}) {
  const t = String(text || '')
  const n = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0)
  const hurts = n(rel.hurts)
  const done = n(goals.done)
  const failed = n(goals.failed)

  // 先看是不是在"夸"：夸 + 真做成过事 = 骄傲（不是无脑开心）
  if (/(真棒|好厉害|牛啊|太强了|你做得好|服了你)/.test(t) && done > 0) {
    return { kind: 'pride', line: '被夸还是会飘一下，不过我自己知道哪来的底气', because: 'praise+done' }
  }
  // 被当众点出来 / 丢脸：羞耻
  if (/(丢人|丢脸|尴尬|出丑|不嫌害臊)/.test(t)) {
    return { kind: 'shame', line: '别说了，我耳朵都热了', because: 'shame-cue' }
  }
  // 自己认错 + 之前确实伤过对方：内疚
  if (/(我的错|我搞砸|是我不好|对不起|抱歉)/.test(t) && (hurts > 0 || failed > 0)) {
    return { kind: 'guilt', line: '这事是我没做好，心里过不去', because: 'self-blame+damage' }
  }
  return { kind: null, line: null, because: 'none' }
}
