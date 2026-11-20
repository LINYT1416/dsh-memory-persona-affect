// 社会判断：来源信任 + 威胁 + 关系 + 过度信任自检。
// 对应文档：4.6 社会情绪与信任、4.7 损伤表。
//
// 关键边界：trust 和 threat 是**两个方向**。
// 只有 trust 的插件，效果等于那个"对谁都过度信任"的病人。

export const TRUST_TABLE = {
  user: 1.0,       // 主人直说
  manual: 1.0,     // 手动写
  assistant: 0.7,  // 转述
  tool: 0.6,       // 工具抓取
  group: 0.4,      // 群聊他人
  unknown: 0.5,    // 不知道
}

const THREAT_WORDS = [
  '滚', '闭嘴', '去死', '弄死', '打你', '别烦我', '受够你', '威胁', '报复',
  '傻逼', '废物', '恶心', '垃圾', '蠢', '有病',
]
const THREAT_MILD = ['烦人', '讨厌', '别闹', '走开', '不想理']

const RELATION_RULES = [
  ['family', /我妈|我爸|妈妈|爸爸|家里|老婆|老公|对象|孩子|儿子|女儿|奶奶|爷爷|外婆|外公/],
  ['friend', /朋友|闺蜜|兄弟|哥们|姐妹|室友|同学/],
  ['colleague', /同事|老板|领导|上司|甲方|客户|师兄|师姐|老师/],
  ['stranger', /陌生人|网友|有人|那个人/],
]

/** 来源信任。按人优先于按通道：群聊里要分清是谁说的。 */
export function trustOf(source = {}) {
  const who = String(source.speaker || source.who || '').toLowerCase()
  const channel = String(source.channel || source.via || 'unknown').toLowerCase()

  if (who && source.relation === 'self') return { value: 1, why: 'self' }
  if (who && source.intimacy >= 0.8) return { value: 0.9, why: 'intimate' }

  const base = TRUST_TABLE[channel] ?? TRUST_TABLE.unknown
  // 群聊里，主人说的话仍然按主人算
  if (channel === 'group' && source.isOwner) return { value: 1, why: 'owner-in-group' }
  return { value: base, why: `channel:${channel}` }
}

/**
 * 威胁度。阈值下限 0.5，永不自动升级（A4-2）。
 * R11 之外的另一条：这条不参与 salience 加分，只出标签。
 */
export function threatOf(text) {
  const s = String(text || '')
  const hard = THREAT_WORDS.filter((w) => s.includes(w))
  const mild = THREAT_MILD.filter((w) => s.includes(w))
  let level = 0
  // 一个明确的硬词就该过阈值：只说"滚"也是威胁
  for (const _ of hard) level += 0.55
  for (const _ of mild) level += 0.12
  level = Math.min(1, level)
  const passed = level >= 0.5
  return {
    level: passed ? Number(level.toFixed(3)) : 0,
    raw: Number(level.toFixed(3)),
    passed,
    hits: hard,
    why: hard.length ? 'explicit' : mild.length ? 'mild' : 'none',
  }
}

/** 关系推断：规则版，等图谱（A4-3）。 */
export function relationOf(text) {
  const s = String(text || '')
  for (const [relation, re] of RELATION_RULES) {
    if (re.test(s)) return { relation, confidence: 0.6, degraded: ['rule_only'] }
  }
  return { relation: 'unknown', confidence: 0.2, degraded: ['rule_only'] }
}

/** 亲密度：用互动次数近似，0..1。 */
export function intimacyOf(count) {
  const n = Math.max(0, Number(count) || 0)
  return Number(Math.min(1, Math.log10(1 + n) / 2).toFixed(3))
}

/**
 * 过度信任自检（A4-4）。
 * 对照 4.7：没杏仁核的人对谁都过度信任，反复受骗。
 * 这里反查自己：threat 长期为 0，说明我可能根本没在判。
 */
export function selfAudit({ scored = 0, threatHits = 0, trustAvg = 0.5 } = {}) {
  const n = Number(scored) || 0
  if (n < 30) return { overTrust: false, reason: 'too-few-samples', n }
  const rate = (Number(threatHits) || 0) / n
  if (rate < 0.005 && trustAvg > 0.8) {
    return {
      overTrust: true,
      reason: 'threat-never-fires',
      n,
      threatRate: Number(rate.toFixed(4)),
      trustAvg,
    }
  }
  return { overTrust: false, threatRate: Number(rate.toFixed(4)), n }
}
