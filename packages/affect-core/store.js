// 落盘：state.json / journal.jsonl / commit.json / snapshots/
// 原则：任何一次写盘失败都不许阻塞回复，也不许把内存状态带坏。

import { mkdir, readFile, writeFile, rename, appendFile, readdir, stat, unlink } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'

const HOME = process.env.USERPROFILE || process.env.HOME || os.homedir()

export function coreDir() {
  return path.join(HOME, '.dsh', 'affect', 'core')
}

export function snapshotDir() {
  return path.join(coreDir(), 'snapshots')
}

const STATE_FILE = () => path.join(coreDir(), 'state.json')
const JOURNAL_FILE = () => path.join(coreDir(), 'journal.jsonl')
const COMMIT_FILE = () => path.join(coreDir(), 'commit.json')
const PERSONA_FILE = () => path.join(coreDir(), 'persona.json')

let ready = false

export async function ensureDirs() {
  if (ready) return
  await mkdir(coreDir(), { recursive: true })
  await mkdir(snapshotDir(), { recursive: true })
  ready = true
}

/** 原子写：先写 tmp 再 rename。中途崩了，旧文件还在。 */
async function writeAtomic(file, text) {
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`
  await writeFile(tmp, text, 'utf8')
  await rename(tmp, file)
}

export async function writeJsonAtomic(file, value) {
  await writeAtomic(file, JSON.stringify(value, null, 1))
}

async function readJson(file) {
  try {
    const text = await readFile(file, 'utf8')
    return JSON.parse(text)
  } catch {
    return null
  }
}

// ── 状态 ──────────────────────────────────────────────

export async function loadState(fallback) {
  await ensureDirs()
  const state = await readJson(STATE_FILE())
  if (state && typeof state === 'object' && typeof state.mood === 'number') return state
  // 坏了：从最近 snapshot 恢复，没有就从来没有
  const snap = await loadLatestSnapshot()
  if (snap && typeof snap === 'object' && typeof snap.mood === 'number') {
    return { ...fallback, ...snap, recoveredFrom: 'snapshot' }
  }
  return { ...fallback }
}

export async function saveState(state) {
  try {
    await ensureDirs()
    await writeJsonAtomic(STATE_FILE(), state)
  } catch {
    /* 磁盘满 / 权限：只留内存，不阻塞 */
  }
}

// ── commit（这一 tick 收齐了没有）──────────────────────

export async function writeCommit(commit) {
  try {
    await ensureDirs()
    await writeJsonAtomic(COMMIT_FILE(), commit)
  } catch { /* 同上 */ }
}

// ── journal：只记输入 + 种子 + 版本，不记原话 ─────────

export async function appendJournal(entry) {
  try {
    await ensureDirs()
    await appendFile(JOURNAL_FILE(), JSON.stringify(entry) + '\n', 'utf8')
  } catch { /* 同上 */ }
}

export async function readJournal(limit = 500) {
  try {
    const text = await readFile(JOURNAL_FILE(), 'utf8')
    const lines = text.split('\n').filter(Boolean)
    return lines.slice(-limit).map(line => {
      try { return JSON.parse(line) } catch { return null }
    }).filter(Boolean)
  } catch {
    return []
  }
}

export async function pruneJournal(keepDays = 7) {
  try {
    const cutoff = Date.now() - keepDays * 86400_000
    const text = await readFile(JOURNAL_FILE(), 'utf8')
    const kept = text.split('\n').filter(Boolean).filter(line => {
      try {
        const item = JSON.parse(line)
        return typeof item.at === 'number' && item.at >= cutoff
      } catch { return false }
    })
    await writeAtomic(JOURNAL_FILE(), kept.join('\n') + (kept.length ? '\n' : ''))
  } catch { /* 没有 journal 就算了 */ }
}

// ── snapshot：每小时一份，留 24 份 ────────────────────

export async function saveSnapshot(state, now = Date.now()) {
  try {
    await ensureDirs()
    const stamp = new Date(now).toISOString().replace(/[:.]/g, '-')
    await writeJsonAtomic(path.join(snapshotDir(), `snapshot-${stamp}.json`), state)
    const files = (await readdir(snapshotDir()))
      .filter(name => name.endsWith('.json'))
      .sort()
    for (const name of files.slice(0, Math.max(0, files.length - 24))) {
      await unlink(path.join(snapshotDir(), name)).catch(() => {})
    }
  } catch { /* 同上 */ }
}

export async function loadLatestSnapshot() {
  try {
    await ensureDirs()
    const files = (await readdir(snapshotDir())).filter(name => name.endsWith('.json')).sort()
    if (!files.length) return null
    return await readJson(path.join(snapshotDir(), files[files.length - 1]))
  } catch {
    return null
  }
}

// ── persona ──────────────────────────────────────────

export const DEFAULT_PERSONA = {
  moodBase: 0.1,
  tauMoodH: 3,
  tickMs: 60_000,
  arousalGain: 1.0,
  expressGain: 1.0,
  moodCap: 0.75,
  injectMaxLines: 7,
  journalKeepDays: 7,
}

export async function loadPersona() {
  await ensureDirs()
  const saved = await readJson(PERSONA_FILE())
  if (!saved || typeof saved !== 'object') {
    try { await writeJsonAtomic(PERSONA_FILE(), DEFAULT_PERSONA) } catch { /* ignore */ }
    return { ...DEFAULT_PERSONA }
  }
  return { ...DEFAULT_PERSONA, ...saved }
}

export async function savePersona(persona) {
  try {
    await ensureDirs()
    await writeJsonAtomic(PERSONA_FILE(), { ...DEFAULT_PERSONA, ...persona })
  } catch { /* ignore */ }
}

// ── 目录大小（面板用）────────────────────────────────

export async function dirSize() {
  try {
    let total = 0
    const walk = async (dir) => {
      const items = await readdir(dir, { withFileTypes: true })
      for (const item of items) {
        const full = path.join(dir, item.name)
        if (item.isDirectory()) await walk(full)
        else total += (await stat(full)).size
      }
    }
    await walk(coreDir())
    return total
  } catch {
    return 0
  }
}
