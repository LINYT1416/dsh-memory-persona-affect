// 存储：state.json + journal.jsonl。schema 2 才认。

import { mkdir, readFile, writeFile, appendFile } from 'node:fs/promises'
import { join } from 'node:path'

export function createStore(home) {
  const dir = join(home, 'persona')
  const file = join(dir, 'state.json')
  const journalFile = join(dir, 'journal.jsonl')
  let state = null
  let saving = Promise.resolve()

  return {
    dir,
    journalFile,

    async load(fresh) {
      try {
        const raw = JSON.parse(await readFile(file, 'utf8'))
        state = { ...fresh(), ...raw }
      } catch {
        state = fresh()
      }
      return state
    },

    get() { return state },
    set(next) { state = next },

    save() {
      saving = saving.then(async () => {
        try {
          await mkdir(dir, { recursive: true })
          await writeFile(file, JSON.stringify(state, null, 1), 'utf8')
        } catch { /* 存不下不影响说话 */ }
      })
      return saving
    },

    async log(entry) {
      try {
        await mkdir(dir, { recursive: true })
        await appendFile(journalFile, JSON.stringify(entry) + '\n', 'utf8')
      } catch { /* 记不下也不阻塞 */ }
    },
  }
}
