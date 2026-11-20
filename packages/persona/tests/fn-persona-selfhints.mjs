import { selfHints } from '../core/style.js'
const a = selfHints('说话像打字：一条 1～3 句，多用语气词但别每句感叹号')
const b = selfHints('性格活泼')
const ok = a.length === 3 && b.length === 0
console.log(ok ? `PASS 人设提示（${a.join('｜')}；无人设要求时 0 条）` : 'FAIL ' + JSON.stringify({ a, b }))
process.exit(ok ? 0 : 1)
