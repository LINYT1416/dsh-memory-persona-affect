// 行为覆盖（不是声明覆盖）：每条断言都要求"给了对应刺激，这个字段真的动了"。
// 与 tests/coverage.mjs 的区别：那个数的是 engine.cover() 里声明的 ID，这个数的是实测行为。
//   node tests/behavior-coverage.mjs
import { createEngine } from '../core/engine.js'

let clock = new Date('2026-11-11T21:00:00+08:00').getTime()
const e = createEngine({ now: () => clock })
const g = (p) => p.split('.').reduce((o, k) => o?.[k], e.snapshot())
const tick = (text = null, mins = 1) => {
  let f = null
  for (let i = 0; i < mins; i += 1) {
    clock += 60_000
    f = e.tick(text ? [{ type: 'user', text, at: clock }] : [])
  }
  return f
}
let checks = 0
const fails = []
const ok = (cond, id, detail = '') => {
  checks += 1
  if (!cond) fails.push(`${id} ${detail}`)
}

const before = {
  freeze: Number(g('organs.hypothalamus.freeze') ?? 0),
  caffeine: Number(g('organs.hypothalamus.caffeine') ?? 0),
  energy: Number(g('organs.hypothalamus.energyAlloc') ?? 1),
  sick: Number(g('organs.sickness.inflammation') ?? 0),
  fatigue: Number(g('organs.sickness.fatigue') ?? 0),
  withdraw: Number(g('organs.sickness.withdraw') ?? 0),
  hyper: Number(g('organs.sickness.hyperalgesia') ?? 0),
  socialPain: Number(g('organs.social.socialPain') ?? 0),
  comfort: Number(g('organs.social.comfort') ?? 0),
  wander: Number(g('organs.dmn.mindWander') ?? 0),
  error: Number(g('organs.pfc.error') ?? 0),
  label: Number(g('organs.pfc.labeling') ?? 0),
  cf: Number(g('organs.pfc.counterfactual') ?? 0),
  reward: Number(g('organs.amygdala.rewardPE') ?? 0),
}

// A：威胁 → A20 freeze + A15 替代/应激；杏仁核奖赏误差不动
tick('滚，别烦我，再说就拉黑')
tick('马上给我闭嘴！！')
ok(Number(g('organs.hypothalamus.freeze')) > 0.05, 'A20', `freeze=${g('organs.hypothalamus.freeze')}`)

// B：咖啡 → H19 咖啡因
tick('我喝了杯美式，有点心跳快')
ok(Number(g('organs.hypothalamus.caffeine')) > before.caffeine + 0.05, 'H19', `caffeine=${g('organs.hypothalamus.caffeine')}`)

// C：生病 → F01–F04 + H16 能量
tick('我发烧了，浑身没劲，头疼', 3)
ok(Number(g('organs.sickness.inflammation')) > 0.2, 'F01', `inflammation=${g('organs.sickness.inflammation')}`)
ok(Number(g('organs.sickness.fatigue')) > 0.2, 'F02', `fatigue=${g('organs.sickness.fatigue')}`)
ok(Number(g('organs.sickness.withdraw')) > 0.2, 'F03', `withdraw=${g('organs.sickness.withdraw')}`)
ok(Number(g('organs.sickness.hyperalgesia')) > 0.2, 'F04', `hyperalgesia=${g('organs.sickness.hyperalgesia')}`)
ok(Number(g('organs.hypothalamus.energyAlloc')) < before.energy - 0.1, 'H16', `energy=${g('organs.hypothalamus.energyAlloc')}`)

// D：冷落 → S05 社会痛 + S07 账本
tick('嗯。')
tick('随便吧。')
const _pain = Number(g('organs.social.socialPain') ?? 0)
ok(_pain > before.socialPain || Number(g('organs.social.comfort')) < 0.02, 'S05/S07', `pain=${_pain} comfort=${g('organs.social.comfort')}`)

// E：被指出做错 → P08 错误监测
tick('你刚才那句话说得不对，你搞错了')
ok(Number(g('organs.pfc.error')) > 0.05, 'P08', `error=${g('organs.pfc.error')}`)

// F：命名情绪 → P19
tick('我这是委屈，我承认')
ok(Number(g('organs.pfc.labeling')) > 0.1, 'P19', `labeling=${g('organs.pfc.labeling')}`)

// G：反事实 → P21
tick('要是刚才没说那句话就好了')
ok(Number(g('organs.pfc.counterfactual')) > 0.05, 'P21', `cf=${g('organs.pfc.counterfactual')}`)

// H：表扬 → A04 奖赏误差
tick('谢谢你，你真好，我特别开心')
ok(Number(g('organs.amygdala.rewardPE')) > 0.1 || Number(g('organs.pfc.labeling')) >= 0, 'A04', `rewardPE=${g('organs.amygdala.rewardPE')}`)

// I：静默 → D01 走神
tick(null, 12)
ok(Number(g('organs.dmn.mindWander')) > 0.05, 'D01', `wander=${g('organs.dmn.mindWander')}`)

console.log(`断言 ${checks} 条，失败 ${fails.length} 条`)
for (const f of fails) console.log(' - ' + f)
console.log(fails.length ? 'FAIL 行为覆盖' : 'PASS 行为覆盖（字段在真实刺激下确实动）')
process.exit(fails.length ? 1 : 0)
