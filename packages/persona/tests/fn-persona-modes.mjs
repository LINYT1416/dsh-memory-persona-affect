// 两种人格模式必须真的行为不同：自定义模式带主人写的人设，纯学习模式一个字都不带
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const fails = []
const ok = (c, m, d = '') => { if (!c) { fails.push(m + ' — ' + d); console.log('FAIL ' + m + (d ? ' — ' + d : '')) } }

const PERSONA = '她自己写的样子：我说话很短，别啰嗦。'

function makeHome(mode) {
  const home = mkdtempSync(join(tmpdir(), 'mode-' + mode + '-'))
  mkdirSync(join(home, 'persona'), { recursive: true })
  writeFileSync(join(home, 'persona', 'panel.json'), JSON.stringify({
    mode,
    selfText: PERSONA,
    injectMax: 8,
    knobs: { threatGain: 1, baselineMood: 0, sensitivity: 1 },
    updatedAt: Date.now(),
  }), 'utf8')
  return home
}

async function boot(home, tag) {
  process.env.DSH_HOME = home
  const mod = await import('../index.js?' + tag)
  const services = new Map()
  let spec = null
  mod.apply({
    get: (id) => services.get(id) || null,
    provide: (id, v) => services.set(id, v),
    set: (id, v) => services.set(id, v),
    on: () => () => {},
    effect: () => () => {},
    emit: () => true,
    logger: { info() {}, warn() {}, error() {} },
    systemPrompt: { context: (x) => { spec = x } },
    tools: { register() {} },
    webServer: { register() {} },
  })
  const svc = services.get('memory.persona')
  await new Promise((r) => setTimeout(r, 180))
  return { svc, text: () => String(spec ? spec.text() : '') }
}

// 自定义模式：人设要进注入
const a = await boot(makeHome('custom'), 'custom1')
a.svc.tick([{ type: 'user', text: '在吗' }], 'm')
await new Promise((r) => setTimeout(r, 30))
const customText = a.text()
ok(/她自己认的样子/.test(customText), '自定义模式该把主人写的人设带进注入', customText.slice(0, 120))
ok(/说话很短|别啰嗦/.test(customText), '人设内容不见了', customText.slice(0, 120))

// 纯学习模式：人设一句都不许进
const b = await boot(makeHome('learn'), 'learn1')
b.svc.tick([{ type: 'user', text: '在吗' }], 'm')
await new Promise((r) => setTimeout(r, 30))
const learnText = b.text()
ok(!/她自己认的样子/.test(learnText), '纯学习模式不该带主人写的人设', learnText.slice(0, 120))
ok(!/说话很短|别啰嗦/.test(learnText), '纯学习模式漏了人设内容', learnText.slice(0, 120))

// 两种模式确实不同（不能两个都空、也不能两个都一样）
ok(customText !== learnText, '两种模式的注入完全一样，等于没切换', '')

// 模式要能从仪表页读到
const snap = (fn) => { try { return a.svc.state ? a.svc.state() : null } catch { return null } }
const s = snap()
if (s && s.mode) ok(s.mode === 'custom', '仪表页 mode 不对', String(s.mode))

if (fails.length) process.exit(1)
console.log('PASS 两种人格模式（自定义带人设 / 纯学习不带 / 两者注入确实不同）')
