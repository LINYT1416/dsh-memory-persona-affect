// 定期一致性校验（前额叶 §3.5 / 文档 §3.9 的"定期做一致性校验"）
//
// 已有的一半是"新 vs 旧"：写入时和检索时发现矛盾就记冲突。
// 这里补另外一半"旧 vs 旧"：库里已经躺着的条目之间如果互相矛盾，
// 以前永远不会被发现，因为没人再写一遍。
//
// 宁可漏，不可错：多值谓词、子串包含、假设层、低置信、不同主体，全部不报。

/** 天然可以多值的谓词：主人同时讨厌很多东西，这不叫冲突。 */
const MULTI_VALUED = new Set([
  '讨厌', '喜欢', '会', '想', '正在做', '计划', '经历', '关系', '爱好', '习惯',
  '记得', '说过', '去过', '做过', '在班上', '通勤', '吃', '喝', '听', '看',
])

/** 只有这些谓词才值得判"互斥"（单一取值）。 */
const EXCLUSIVE = new Set([
  '住在', '住', '城市', '地点', '家乡', '籍贯',
  '账号', '手机', '手机号', '电话', '邮箱', '身份证',
  '年龄', '生日', '星座', '职业', '工作', '公司', '学校',
  '性别',
  '身高', '体重', '血型',
])

const MIN_CONF = 0.6

function norm(v) {
  return String(v ?? '').trim().toLowerCase()
}

function overlapping(a, b) {
  const x = norm(a)
  const y = norm(b)
  if (!x || !y) return true // 空值不判，免得误伤
  return x === y || x.includes(y) || y.includes(x)
}

/**
 * 扫一遍 cells，把"同主体同谓词但取值互斥"的旧条目记成冲突。
 * 只 push 冲突队列，绝不改原条目。
 *
 * @param {object} store 皮层 store（需要有 allCells() 和 conflicts 数组）
 * @param {object} opts  { record } 注入记录函数，默认用 ./conflicts.js 的 record
 * @returns {Promise<Array<{aId:string,bId:string,field:string}>>} 新记的冲突
 */
/**
 * 两条记忆是不是真的互斥。写入路径和定期扫描共用同一套规则，
 * 避免"写入时判得松、扫描时判得紧"这种两套标准。
 */
export function conflictingPair(a, b, { strict = true } = {}) {
  if (!a || !b) return false
  if (a.id && b.id && a.id === b.id) return false
  if (String(a.subject || '').trim() !== String(b.subject || '').trim()) return false
  const p = String(a.predicate || '').trim()
  if (!p || p !== String(b.predicate || '').trim()) return false
  if (MULTI_VALUED.has(p)) return false
  if (!EXCLUSIVE.has(p)) return false
  // 缺省值按"事实"和"有底气"算：写入路径上给的新条目往往还没填 state/confidence，
  // 用严格相等会把真冲突也一起漏掉（入站队列那条测试就是这么挂的）。
  const kindOf = (c) => c.kind || 'fact'
  const stOf = (c) => c.state || 'fact'
  if (kindOf(a) === 'event' || kindOf(b) === 'event') return false
  // strict（定期扫描）：只比已经定案的 fact，避免拿一堆假设互相吵架。
  // 非 strict（写入路径）：假设层也要拦——新来的候选跟旧的假设矛盾，同样要标记。
  if (strict && (stOf(a) !== 'fact' || stOf(b) !== 'fact')) return false
  if (stOf(a) === 'retracted' || stOf(b) === 'retracted') return false
  // 置信度门槛只在定期扫描时用：写入路径上刚进来的候选往往还没算置信度，
  // 卡在这里等于把真冲突一起丢掉（入站队列那条测试就是这么挂的）。
  if (strict && (Number(a.confidence ?? 1) < MIN_CONF || Number(b.confidence ?? 1) < MIN_CONF)) return false
  return !overlapping(a.object, b.object)
}

export async function scanConsistency(store, { record } = {}) {
  const rec = record || (await import('./conflicts.js')).record
  const cells = (store?.allCells?.() || []).filter((c) => {
    if (!c || c.retracted || c.archived) return false
    if (c.state !== 'fact') return false            // 假设层不判：本来就没定
    if (c.level && c.level !== 'instance') return false // 抽象层由 supports 负责
    if (Number(c.confidence ?? 0) < MIN_CONF) return false
    const p = String(c.predicate || '')
    if (!p) return false
    if (MULTI_VALUED.has(p)) return false           // 多值谓词不判
    if (!EXCLUSIVE.has(p)) return false             // 不在白名单里不判（宁漏）
    return Boolean(String(c.subject || '').trim()) && Boolean(String(c.object || '').trim())
  })

  const groups = new Map()
  for (const c of cells) {
    const key = `${norm(c.subject)}|${norm(c.predicate)}`
    const list = groups.get(key) || []
    list.push(c)
    groups.set(key, list)
  }

  const openPairs = new Set(
    (store?.conflicts || [])
      .filter((x) => x && x.state === 'open')
      .map((x) => [String(x.aId), String(x.bId)].sort().join('|')),
  )

  const fresh = []
  for (const list of groups.values()) {
    if (list.length < 2) continue
    for (let i = 0; i < list.length; i += 1) {
      for (let j = i + 1; j < list.length; j += 1) {
        const a = list[i]
        const b = list[j]
        if (!conflictingPair(a, b)) continue
        const pairKey = [String(a.id), String(b.id)].sort().join('|')
        if (openPairs.has(pairKey)) continue
        openPairs.add(pairKey)
        await rec(store, a, b, 'consistency')
        fresh.push({ aId: a.id, bId: b.id, field: a.predicate })
      }
    }
  }
  return fresh
}
