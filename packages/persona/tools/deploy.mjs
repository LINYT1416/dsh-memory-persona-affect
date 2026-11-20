// 一次部署：先跑全量测试，再重启一次，然后自动找新端口体检。
// 用法：
//   node tools/deploy.mjs --dry-run   只做预检，不重启
//   node tools/deploy.mjs             真部署（会关掉重启整个桌面端）
import { execSync, spawnSync } from 'node:child_process'
import { readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
const dry = process.argv.includes('--dry-run')
const node = process.execPath

function sh(cmd, opts = {}) {
  return execSync(cmd, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...opts })
}

console.log(dry ? '== 预检（不会重启）==' : '== 部署 ==')

// 1) 全量测试
const files = readdirSync(join(root, 'tests')).filter((f) => f.endsWith('.mjs'))
let ok = 0
const bad = []
for (const f of files) {
  const r = spawnSync(node, [join(root, 'tests', f)], { encoding: 'utf8' })
  if (r.status === 0) ok++
  else bad.push(f)
}
console.log(`测试：${ok}/${files.length} 通过${bad.length ? '，失败：' + bad.join(', ') : ''}`)
if (bad.length) {
  console.log('测试没全绿，拒绝部署。')
  process.exit(1)
}

// 2) 部署前线上快照
const before = spawnSync(node, [join(root, 'tools', 'live-check.mjs')], { encoding: 'utf8' })
if (before.stdout) {
  console.log('部署前：' + before.stdout.trim().split('\n').slice(0, 3).join(' | '))
} else {
  console.log('部署前：连不上，跳过快照')
}

if (dry) {
  console.log('预检通过：测试全绿，可以部署（去掉 --dry-run 才真的重启）')
  process.exit(0)
}

// 3) 重启（只这一次）
console.log('重启中（会关掉桌面端再拉起）…')
try { spawnSync('cmd.exe', ['/c', 'E:\\brain\\_affect_restart.cmd'], { stdio: 'ignore' }) } catch { /* 脚本自己会重开 */ }

// 4) 等新端口，扫监听端口找 5xxxx
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let port = null
for (let i = 0; i < 40; i++) {
  await sleep(5000)
  try {
    const out = sh('powershell -NoProfile -Command "Get-NetTCPConnection -State Listen | Where-Object { $_.LocalPort -ge 50000 -and $_.LocalPort -le 59999 } | Select-Object -ExpandProperty LocalPort -Unique"')
    const ports = out.split(/\s+/).map(Number).filter(Boolean)
    if (ports.length) { port = ports[0]; break }
  } catch { /* 还没起来 */ }
}
if (!port) {
  console.log('等超时：没找到监听端口。手动打开桌面端后跑 tools/live-check.mjs <port> 复查。')
  process.exit(1)
}
console.log('新端口：' + port)

// 5) 体检
const check = spawnSync(node, [join(root, 'tools', 'live-check.mjs'), String(port)], { encoding: 'utf8' })
console.log(check.stdout.trim())
process.exit(check.status === 0 || check.status === 2 ? 0 : 1)
