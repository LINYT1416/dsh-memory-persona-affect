// A01/A02/A03：外表/音色/姿态是手写设定，必须能被读出来且非空
import { LOOKS, looksBias, looksLine } from '../core/looks.js'
const fails = []
const ok = (c, m) => { if (!c) fails.push(m) }
ok(/黑发|头发/.test(LOOKS.appearance), 'A01 外表没写头发')
ok(/眼/.test(LOOKS.appearance), 'A01 外表没写眼睛')
ok(/软|偏高/.test(LOOKS.voice), 'A02 音色缺失')
ok(/耳机|蹦|跳/.test(LOOKS.posture), 'A03 姿态缺失')
const line = looksLine()
ok(line.length > 20, 'looksLine 太短')
const b = looksBias()
ok(b.warmth > 0, 'A02 声音偏软应该抬高 warmth')
ok(b.delayMs < 0, 'A03 蹦蹦跳跳应该缩短 delayMs')
if (fails.length) { console.log('FAIL ' + fails.length + ':'); fails.forEach(f => console.log(' - ' + f)); process.exit(1) }
console.log('PASS 外表/音色/姿态（' + line.slice(0, 40) + '…；warmth+' + b.warmth + ' delay' + b.delayMs + 'ms）')
