// 清掉我自己写进海马体的测试数据。
// 只删带「落账验证」标记的那些（我写的，标了"可删"），不动别人的链路测试。
// 跑法：node tests/clean-test-data.mjs [--dry]

import { readFile, writeFile, readdir, mkdir, copyFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'

const { isTestText } = await import('../lib/score.js')

const HIPPO = process.env.HIPPOCAMPUS_DIR || join(homedir(), '.dsh', 'hippocampus')
const dry = process.argv.includes('--dry')
const MARK = /落账验证|链路测试/   // 我写的那批 + 别人留的通路验证条

const stamp = new Date().toISOString().replace(/[:.]/g, '-')
const backup = `${HIPPO}.bak-clean-${stamp}`

async function readJsonl(p) {
  try {
    const text = await readFile(p, 'utf8')
    return text.split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l))
  } catch {
    return []
  }
}

async function writeJsonl(p, rows) {
  await writeFile(p, rows.map((r) => JSON.stringify(r)).join('\n') + (rows.length ? '\n' : ''), 'utf8')
}

function hit(row) {
  const t = String(row.summary || row.text || '')
  return MARK.test(t) || (isTestText(t) && MARK.test(t))
}

async function main() {
  if (!existsSync(HIPPO)) {
    console.log('海马体目录不存在：', HIPPO)
    return
  }
  console.log(dry ? '== 干跑，不写盘 ==' : '== 真删 ==')
  console.log('目录：', HIPPO)

  if (!dry) {
    await mkdir(backup, { recursive: true })
    for (const f of ['episodes.jsonl', 'index.jsonl']) {
      const p = join(HIPPO, f)
      if (existsSync(p)) await copyFile(p, join(backup, f))
    }
    const rawDir = join(HIPPO, 'raw')
    if (existsSync(rawDir)) {
      await mkdir(join(backup, 'raw'), { recursive: true })
      for (const name of await readdir(rawDir)) {
        if (name.endsWith('.jsonl')) {
          await copyFile(join(rawDir, name), join(backup, 'raw', name))
        }
      }
    }
    console.log('已备份到：', backup)
  }

  const plan = [
    { file: join(HIPPO, 'episodes.jsonl'), key: 'episodes' },
    { file: join(HIPPO, 'index.jsonl'), key: 'index' },
  ]

  for (const item of plan) {
    const rows = await readJsonl(item.file)
    const keep = rows.filter((r) => !hit(r))
    const removed = rows.length - keep.length
    console.log(`  ${item.key}: ${rows.length} → ${keep.length}（删 ${removed}）`)
    if (!dry && removed) await writeJsonl(item.file, keep)
  }

  // raw 分卷
  const rawDir = join(HIPPO, 'raw')
  if (existsSync(rawDir)) {
    for (const name of await readdir(rawDir)) {
      if (!name.endsWith('.jsonl')) continue
      const p = join(rawDir, name)
      const rows = await readJsonl(p)
      const keep = rows.filter((r) => !hit(r))
      const removed = rows.length - keep.length
      if (removed) {
        console.log(`  raw/${name}: ${rows.length} → ${keep.length}（删 ${removed}）`)
        if (!dry) await writeJsonl(p, keep)
      }
    }
  }

  // 我自己的打分记录
  const own = join(process.env.AMYGDALA_DIR || join(homedir(), '.dsh', 'amygdala'), 'scores.jsonl')
  if (existsSync(own)) {
    const rows = await readJsonl(own)
    const keep = rows.filter((r) => !(r.tags || []).includes('test'))
    const removed = rows.length - keep.length
    if (removed) {
      console.log(`  amygdala/scores: ${rows.length} → ${keep.length}（删 ${removed}）`)
      if (!dry) await writeJsonl(own, keep)
    }
  }

  console.log(dry ? '干跑结束' : '清理完成')
}

await main()
