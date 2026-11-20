// 注入名额分配：不能让一个器官占满（想要很强时，别整屏都是"想要"）
import { describe } from '../core/desc.js'

const fails = []
const ok = (c, m, d = '') => { if (!c) { fails.push(m + ' — ' + d); console.log('FAIL ' + m + (d ? ' — ' + d : '')) } }

// 纹状体五条全拉满，只有一条 tpj 冒犯刚过线
const reads = {
  str: { wanting: 0.95, primed: 0.95, stop: 0.9, broken: 0.9, satiation: 0.9, ritual: 0.9 },
  tpj: { offense: 0.4 },
}
const lines = describe({ reads }, { max: 5, prev: [] })

const strCount = lines.filter((l) => /想要|顺手|被打断|该停|腻了|这一套/.test(l)).length
const hasOffense = lines.some((l) => /戳到|扎到|被扎/.test(l))

// 上限被器官配额卡住时行数会少于 max，这是对的：宁可少说，不能一个器官刷屏
ok(lines.length >= 3 && lines.length <= 5, '行数不在 3~5 之间', String(lines.length))
ok(strCount <= 2, '一个器官最多 2 行，实际 ' + strCount + '：' + lines.join(' | '))
ok(hasOffense, 'tpj 那条被饿死了（说明还是按强度独占）：' + lines.join(' | '))

// 只给一个器官时不该空着：填满就行
const onlyStr = describe({ reads: { str: { wanting: 0.9, primed: 0.9, stop: 0.9 } } }, { max: 3, prev: [] })
ok(onlyStr.length >= 1, '只有一个器官时不该什么都不说', onlyStr.join(' | '))

if (fails.length) process.exit(1)
console.log('PASS 名额分配（纹状体 6 条拉满时只占 ≤2 行，tpj 仍能挤进一句；单器官不空转）')
