import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

﻿// 主动提起：她该自己想起点旧事，而不是等人问。
// 规则：够旧（>2 天）、没提过、不是情绪条目，才有资格被想起；一条只提一次。
const DAY = 24 * 60 * 60 * 1000

const CUES = [
  /(今天|昨天|明天|早上|中午|晚上|半夜|刚才|后来|最近|\d+\s*点)/,
  /(家|公司|地铁|食堂|店|路|房间|床|桌|门口|楼下|窗)/,
  /(买|吃|做|去|说|帮|改|写|修|跑|看|听|睡|等|给|拿|走|回|发|聊)/,
  /(我|你|他|她|我们|你们|他们)/,
]

// 像不像一件事：线索越多越值得被想起；纯应答和碎片宁愿不出
function concreteScore(text) {
  let n = 0
  for (const re of CUES) if (re.test(text)) n += 1
  return n
}


export function pickRecall(episodes, { now = Date.now(), used = new Set(), minAge = 0.25 * DAY, max = 1 } = {}) {
  const out = []
  const seen = new Set()  // 记忆里同一条会重复出现（重放/巩固），别让同一句被想起三次
  const list = Array.isArray(episodes) ? episodes : []
  for (const e of list) {
    const text = String(e?.brief || '').trim()
    if (text.length < 6) continue
    if (/^【情绪】/.test(text)) continue
    if (used.has(text)) continue
    if (seen.has(text)) continue
    seen.add(text)
    const at = Number(e?.at || 0)
    if (!Number.isFinite(at) || at <= 0) continue
    if (now - at < minAge) continue
    const cs = concreteScore(text)
        // 至少两类线索，或者够长，才算“一件事”
        if (cs < 2 && text.length < 16) continue
        out.push({ text, at, cs })
  }
  out.sort((a, b) => (b.cs - a.cs) || (b.at - a.at))
  return out.slice(0, max).map((x) => ({ text: x.text, at: x.at, line: `突然想起${x.text.replace(/^我说[：:]\s*/, '')}` }))
}

// "提过就只提一次"要跨重启才算数：落盘，最多记 200 条
export function loadUsed(file) {
  try {
    const j = JSON.parse(readFileSync(file, 'utf8'))
    return new Set(Array.isArray(j.used) ? j.used.map(String) : [])
  } catch { return new Set() }
}

export function saveUsed(file, set) {
  try {
    const used = [...(set || [])].slice(-200)
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, JSON.stringify({ used }, null, 0), 'utf8')
    return true
  } catch { return false }
}

// 该不该提了：按「距上次过了多少拍」算，不按取模（ticks 只在有消息时涨，取模会饿很久）
export function isRecallDue(tick, lastTick, gap = 12) {
  const t = Number(tick) || 0
  if (t <= 0) return false
  // 刚起来是「从没提过」，不该再等 12 拍；否则每次重启都要重新攒
  if (lastTick === undefined || lastTick === null) return true
  return t - Number(lastTick) >= gap
}
