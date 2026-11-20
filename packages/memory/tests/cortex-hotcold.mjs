// P0：冷热分层自检。
// 生产逻辑一行没改——只是把时间戳往回拨，看 tierOf / archiveCold 会不会按文档说的那样动。
// 文档要求：近期热存、远期冷存；归档只是打标记，不删、可恢复。
import { tierOf, refreshTier, archiveCold, HOT_DAYS } from '../organs/cortex/lib/hot-cold.js'

let fail = 0
const ok = (c, m) => { if (!c) { fail++; console.log('FAIL', m) } else { console.log('  ok:', m) } }

const DAY = 86400000
const now = Date.UTC(2026, 10, 13, 14, 0, 0) // 固定“现在”，不依赖跑测试的时刻
const cell = (over = {}) => ({ id: 'c1', text: 'x', confidence: 0.6, evidenceCount: 1, lastSeen: now, ...over })

// 1) 今天见过的 → hot
ok(tierOf(cell(), now) === 'hot', '今天见过应为 hot')

// 2) 超过 30 天 → cold
ok(tierOf(cell({ lastSeen: now - (HOT_DAYS + 1) * DAY }), now) === 'cold', `${HOT_DAYS}+1 天前应为 cold`)

// 3) 边界内仍 hot
ok(tierOf(cell({ lastSeen: now - (HOT_DAYS - 1) * DAY }), now) === 'hot', `第 ${HOT_DAYS - 1} 天仍应为 hot`)

// 4) refreshTier 会把结果写回对象
const c4 = cell({ lastSeen: now - (HOT_DAYS + 5) * DAY })
ok(refreshTier(c4, now) === 'cold' && c4.tier === 'cold', 'refreshTier 应写回 tier 字段')

// 5) 冷 + 低置信 + 证据不足 → 归档，但条目还在数组里（不是删除）
const old = cell({ id: 'old1', lastSeen: now - 60 * DAY, confidence: 0.3, evidenceCount: 1 })
const arr = [old]
const archived = archiveCold(arr, now)
ok(archived.includes('old1'), '又冷又弱应被归档')
ok(arr.length === 1 && arr[0].archived === true, '归档只打标记，不删除')
ok(arr[0].retracted !== true, '归档不等于作废')

// 6) 冷但证据够 → 不归档
const strong = cell({ id: 'old2', lastSeen: now - 60 * DAY, confidence: 0.3, evidenceCount: 5 })
const arr2 = [strong]
ok(archiveCold(arr2, now).length === 0, '证据够的冷条目不该归档')

// 7) 冷但置信度高 → 不归档
const sure = cell({ id: 'old3', lastSeen: now - 90 * DAY, confidence: 0.9, evidenceCount: 1 })
ok(archiveCold([sure], now).length === 0, '高置信的冷条目不该归档')

// 8) 已归档 / 已作废不重复处理
const done = cell({ id: 'old4', lastSeen: now - 60 * DAY, confidence: 0.2, archived: true })
const gone = cell({ id: 'old5', lastSeen: now - 60 * DAY, confidence: 0.2, retracted: true })
ok(archiveCold([done, gone], now).length === 0, '已归档/已作废不重复归档')

// 9) 热的不归档
const hot = cell({ id: 'h1', confidence: 0.2, evidenceCount: 1 })
ok(archiveCold([hot], now).length === 0, '热条目不该归档')

console.log(fail ? `FAIL ${fail}` : 'PASS 冷热分层（hot/cold 边界、归档只标记、证据与置信度豁免、重复豁免）')
process.exit(fail ? 1 : 0)
