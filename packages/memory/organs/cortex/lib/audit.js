// 巩固审计（F19、C6）：每次蒸馏做了什么、为什么，落日志。
import { appendJsonl, FILES } from './store.js'

export async function log(entry) {
  const row = { at: Date.now(), ...entry }
  await appendJsonl(FILES.audit, row)
  return row
}

export function summary(entries = []) {
  const out = { batches: entries.length, processed: 0, promoted: 0, conflicts: 0, retracted: 0 }
  for (const e of entries) {
    out.processed += e.processed || 0
    out.promoted += e.promoted || 0
    out.conflicts += e.conflicts || 0
    out.retracted += e.retracted || 0
  }
  return out
}
