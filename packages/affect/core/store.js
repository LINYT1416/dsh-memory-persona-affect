// 存储：一个 state.json + 一份 journal。单包不需要 pending/commit 两阶段，
// 但保留 journal，调参时能回放。
import { mkdir, readFile, writeFile, appendFile } from 'node:fs/promises'
import { join } from 'node:path'

export function createStore(home) {
  const dir = join(home, 'affect')
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
        // 睡一觉回血：贴地板的心情不该跨重启继承。
        // 上次停在 -0.38、威胁 0.69、panic 1.0，重开还是那副样子，人不是这么过夜的。
        const _base = 0.1
        if (Number.isFinite(state.mood) && state.mood < _base - 0.35) {
          state.mood = _base - 0.12
        }
        const _am = state.organs && state.organs.amygdala
        if (_am && Number(_am.threat) > 0.8) _am.threat = 0.35
        if (_am && Number(_am.fastThreat) > 0.8) _am.fastThreat = 0.35
        const _bs = state.organs && state.organs.brainstem
        if (_bs && Number(_bs.panic) > 0.6) _bs.panic = 0.15
        const _in = state.organs && state.organs.insula
        if (_in && Number(_in.intensity) > 0.7) _in.intensity = 0.3
      } catch {
        state = fresh()
      }
      return state
    },
    get() {
      return state
    },
    set(next) {
      state = next
    },
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
