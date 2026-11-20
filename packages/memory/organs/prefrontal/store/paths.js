// 前额叶自己的数据目录。只写这里，别人的库一概只读（C2）。
import { homedir } from 'node:os'
import { join } from 'node:path'

export const DATA_DIR = process.env.PREFrontal_DIR || join(homedir(), '.dsh', 'prefrontal')

export const FILES = {
  hot: join(DATA_DIR, 'hot.json'),
  tasks: join(DATA_DIR, 'tasks.jsonl'),
  ledger: join(DATA_DIR, 'ledger.jsonl'),
  suppressed: join(DATA_DIR, 'suppressed.jsonl'),
  conflicts: join(DATA_DIR, 'conflicts.jsonl'),
  telemetry: join(DATA_DIR, 'telemetry.json'),
  calibration: join(DATA_DIR, 'calibration.json'),
  meta: join(DATA_DIR, 'meta.json'),
  flags: join(DATA_DIR, 'flags.json'),
}

/** 账本上限：P5-4 防止自己无限涨。 */
export const LIMITS = {
  hotItems: 8,
  hotChars: 1200,
  ledgerLines: 4000,
  suppressedLines: 2000,
  conflictLines: 1000,
  suppressedTtlMs: 6 * 3600 * 1000,
}

export const VERSION = { store: 1, contract: 1 }
