// 线上体检：现在这个端口上跑的那份，到底有哪些字段、什么模式。
// 用法：node tools/live-check.mjs [port]
// 只在读，不改任何东西。

const port = process.argv[2] || '58288'
const base = `http://127.0.0.1:${port}`

async function get(p) {
  const r = await fetch(base + p)
  if (!r.ok) throw new Error(`${p} -> HTTP ${r.status}`)
  return r.json()
}

const REQUIRED = [
  'mode', 'injectMax', 'looks', 'organs', 'style', 'coverage',
  'relation', 'goals', 'conflicts', 'possess', 'crave',
  'worth', 'habit', 'keyPeriod', 'consistency', 'identity',
  'speakers', 'storyline', 'interlocutor',
]

try {
  const st = await get('/persona/state')
  const keys = Object.keys(st || {})
  const missing = REQUIRED.filter((k) => !keys.includes(k))
  console.log(`端口 ${port} 在线`)
  console.log('返回字段数：' + keys.length)
  console.log('mode = ' + JSON.stringify(st.mode))
  console.log('有的字段：' + keys.join(', '))
  if (missing.length) {
    console.log('缺的字段（说明线上还是旧版）：' + missing.join(', '))
    process.exitCode = 2
  } else {
    console.log('字段齐了')
  }
} catch (e) {
  console.log(`连不上 ${base}：${e.message}`)
  process.exitCode = 3
}
