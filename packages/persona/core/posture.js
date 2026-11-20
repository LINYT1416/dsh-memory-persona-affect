// A03 姿态与小动作：不同情绪下她会下意识做不同的小动作。
// 不动脸、不改外形，只给"手上/身体上"的一个动作提示。

const GESTURES = [
  { key: 'anxious', line: '（这会儿她一直转笔，停不下来）' },
  { key: 'happy', line: '（说这话时脚在地上轻轻打着拍子）' },
  { key: 'sad', line: '（她把外套裹紧了一点，抱着膝盖）' },
  { key: 'tired', line: '（她揉了揉眼睛，又撑着坐直）' },
  { key: 'shy', line: '（她低头把耳机线绕来绕去）' },
]

/**
 * @param {object} reads 六器官读数
 * @returns {{ gesture:string|null, key:string|null }}
 */
export function posture(reads = {}) {
  const n = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0)
  const pcc = reads.pcc || {}
  const ofc = reads.ofc || {}
  const str = reads.str || {}

  if (n(pcc.crisis) > 0.5) return { gesture: GESTURES[0].line, key: 'anxious' }
  if (n(ofc.shame) > 0.55) return { gesture: GESTURES[4].line, key: 'shy' }
  if (n(str.stop) > 0.65) return { gesture: GESTURES[3].line, key: 'tired' }
  if (n(ofc.warm) > 0.6) return { gesture: GESTURES[1].line, key: 'happy' }
  if (Number.isFinite(Number((reads.mpfc || {}).esteem)) && Number(reads.mpfc.esteem) < 0.3) {
    return { gesture: GESTURES[2].line, key: 'sad' }
  }
  return { gesture: null, key: null }
}
