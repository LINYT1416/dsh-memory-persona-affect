// 测试专用数据目录：每次跑都换一个，绝不碰 ~/.dsh/prefrontal。
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const dir = mkdtempSync(join(tmpdir(), 'pf-test-'))
process.env.PREFrontal_DIR = dir
process.env.PREFRONTAL_DIR = dir

export const TEST_DIR = dir

export function cleanup() {
  try { rmSync(dir, { recursive: true, force: true }) } catch { /* 删不掉就算了 */ }
}
