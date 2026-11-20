import { selfBias } from '../core/style.js'
const t = '性格：话多爱笑。\n- 面吃上了，有点咸但真香\n- 苦就苦呗，饭还是得吃。\n- 知道啦，你也别熬。\n- 崩了就崩了嘛，我又不会跑。\n- 嗯，等我一会儿。'
const b = selfBias(t, { warmth: 0.08, delayMs: -120 })
const ok = b.brevity > 0 && b.warmth > 0.08 && b.delayMs === -120
console.log(ok ? `PASS 自述→偏置（brevity ${b.brevity} warmth ${b.warmth.toFixed(3)} delay ${b.delayMs}）` : 'FAIL ' + JSON.stringify(b))
process.exit(ok ? 0 : 1)
