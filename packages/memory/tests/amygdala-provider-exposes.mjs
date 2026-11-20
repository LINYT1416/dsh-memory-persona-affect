// provider 是白名单对象：api 上有 bind/extinguish/reviewSweep，provider 里没挂出去，
// 海马体拿到的是 provider → typeof svc.bind === 'undefined' → 绑定静默跳过。
import { readFileSync } from 'node:fs'

const src = readFileSync('E:/memory/dsh-all/organs/amygdala/index.js', 'utf8')

let fail = 0
const ok = (c, m) => { if (!c) { fail++; console.log('FAIL', m) } else { console.log('  ok:', m) } }

// provider 段（provide 之前那一段）必须包含三个口
const provideAt = src.indexOf("ctx.provide?.('memory.amygdala'")
ok(provideAt > 0, '找得到 provide')
const providerSrc = src.slice(Math.max(0, provideAt - 5000), provideAt)
ok(/bind:\s*\(input\)\s*=>\s*api\.bind/.test(providerSrc), 'provider 要暴露 bind')
ok(/extinguish:\s*\(input\)\s*=>\s*api\.extinguish/.test(providerSrc), 'provider 要暴露 extinguish')
ok(/reviewSweep:\s*\(input\)\s*=>\s*api\.reviewSweep/.test(providerSrc), 'provider 要暴露 reviewSweep')

// api 上必须有实现
ok(/bind\(input = \{\}\)\s*\{/.test(src), 'api 要有 bind 实现')
ok(/already-bound/.test(src), 'bind 要去重')
ok(/extinguish\(input = \{\}\)\s*\{/.test(src), 'api 要有 extinguish 实现')
ok(/reviewSweep\(input = \{\}\)\s*\{/.test(src), 'api 要有 reviewSweep 实现')

// 海马体包装层要透传
const ad = readFileSync('E:/memory/dsh-all/organs/hippocampus/lib/adapters.js', 'utf8')
ok(/bind: \(input\) =>/.test(ad), '海马体包装层要透传 bind')

console.log(fail ? `FAIL ${fail}` : 'PASS 杏仁核 provider 暴露（bind / extinguish / reviewSweep 三端齐全）')
process.exit(fail ? 1 : 0)
