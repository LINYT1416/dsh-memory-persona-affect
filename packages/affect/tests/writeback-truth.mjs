// 心情插件 · 写回对账 + 最近记忆过滤
//
// 这块以前是"假阳性发生器"：
//   1. annotate 调完 hip.write 就 wrote=true，没等结果 → 账本 177 条，记忆侧 34 条
//   2. recentEpisodes 不过滤【情绪】条目 → DMN 的"最近发生了什么"六条全是垃圾
// 这个测试不测"有没有数"，只测"两边对不对得上"。
//
//   node tests/writeback-truth.mjs
//
// 用临时 DSH_HOME，绝不碰真账本。
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const home = mkdtempSync(join(tmpdir(), 'affect-wb-'))
process.env.DSH_HOME = home

const { createBridge } = await import('../core/bridge.js')

const fails = []
const ok = (cond, msg) => { if (!cond) fails.push(msg) }

// ── 假记忆器官：可控成功/失败 ─────────────────────────────
function makeHip(opts = {}) {
  const state = { writes: 0, rows: opts.rows || [] }
  return {
    state,
    write(input) {
      state.writes += 1
      if (opts.failWith) return Promise.reject(new Error(opts.failWith))
      return Promise.resolve({ ok: true, id: `ep-${state.writes}`, text: input.text })
    },
    episodes: async () => state.rows,
    recallSync: () => ({ ok: true, degraded: false, valenceReady: true, hits: [], ms: 1 }),
    recall: async () => ({ hits: [] }),
  }
}

// ── 1. 成功路径：attempted=1, landed=1, landedRate=1 ──────
{
  const hip = makeHip()
  const b = createBridge((id) => (id === 'memory.hippocampus' ? hip : null))
  const r = b.annotate({ kind: '委屈', valence: -0.4, intensity: 0.5, brief: '被顶了一下' }, 's1', -0.2)
  ok(r.wrote === true, '成功路径 wrote 应为 true（本地账本 + 对方接了）')
  ok(r.noted === true, 'noted 应为 true')
  ok(r.memory === 'pending', `刚调用时 memory 应是 pending，实际 ${r.memory}`)
  const before = b.writebackTruth()
  ok(before.attempted === 1 && before.landed === 0,
    `未 await 时不该算落库，实际 attempted=${before.attempted} landed=${before.landed}`)
  await r.done
  const after = b.writebackTruth()
  ok(after.landed === 1 && after.failed === 0, `await 后应 landed=1，实际 ${JSON.stringify(after)}`)
  ok(after.landedRate === 1, `落库率应为 1，实际 ${after.landedRate}`)
  ok(after.inFlight === 0, `不应有在途，实际 ${after.inFlight}`)
}

// ── 2. 失败路径：wrote 不能骗人，failed 必须记上 ──────────
{
  const hip = makeHip({ failWith: 'disk full' })
  const b = createBridge((id) => (id === 'memory.hippocampus' ? hip : null))
  const r = b.annotate({ kind: '厌烦', brief: '算了' }, 's2', -0.3)
  ok(r.memory === 'pending', '调用后仍是 pending（还没结果）')
  await r.done
  const t = b.writebackTruth()
  ok(t.failed === 1, `对方拒收要记 failed=1，实际 ${t.failed}`)
  ok(t.landedRate === 0, `落库率应为 0，实际 ${t.landedRate}`)
  ok(t.lastError === 'disk full', `错误要留证，实际 ${t.lastError}`)
  ok(r.wrote === true, 'wrote 现在只代表"账本记了"，不该因对方失败而变 false——两件事分开报')
}

// ── 3. recentEpisodes：必须挡掉【情绪】，且保留 valence 的 0/null 区别 ──
{
  const now = Date.now()
  const hip = makeHip({
    rows: [
      { id: 'a', brief: '【情绪】委屈：被顶了一下', summary: '【情绪】委屈：被顶了一下', type: 'emotion', valence: -0.4, at: now - 1000 },
      { id: 'b', brief: '在客厅改 recallSync', summary: '在客厅改 recallSync', type: 'scene', valence: -0.2, at: now - 2000 },
      { id: 'c', brief: '【情绪】有情绪：算了', summary: '【情绪】有情绪：算了', type: 'emotion', valence: 0, at: now - 3000 },
      // 老数据：brief 是干净的，标签只在 summary 里 —— 只看第一个非空字段会漏，这条专测它
      { id: 'd', brief: '老数据 brief 干净', summary: '【情绪】委屈：老数据', valence: 0.3, at: now - 4000 },
      { id: 'e', brief: '这条没有效价', summary: '这条没有效价', type: 'scene', at: now - 5000 },
    ],
  })
  const b = createBridge((id) => (id === 'memory.hippocampus' ? hip : null))
  const list = await b.recentEpisodes(6, 5)
  ok(Array.isArray(list), 'recentEpisodes 应返回数组')
  const briefs = (list || []).map((x) => x.brief)
  ok(!briefs.some((x) => String(x).startsWith('【情绪】')), `【情绪】没挡干净：${briefs.join(' / ')}`)
  ok(!briefs.includes('老数据 brief 干净'), 'brief 干净但 summary 带【情绪】的老数据也必须挡')
  ok(briefs.length === 2, `应剩 2 条真记忆，实际 ${briefs.length}：${briefs.join(' / ')}`)
  const e = (list || []).find((x) => x.brief === '这条没有效价')
  ok(e && e.valence === null, `缺效价要明确 null，实际 ${JSON.stringify(e)}`)
}

// ── 4. 全是情绪条目时，应返回 null 而不是空数组（上层要能区分"没有"和"拿不到"）──
{
  const now = Date.now()
  const hip = makeHip({
    rows: [
      { id: 'a', brief: '【情绪】委屈：x', summary: '【情绪】委屈：x', type: 'emotion', at: now },
      { id: 'b', brief: '【情绪】厌烦：y', summary: '【情绪】厌烦：y', type: 'emotion', at: now },
    ],
  })
  const b = createBridge((id) => (id === 'memory.hippocampus' ? hip : null))
  const list = await b.recentEpisodes(6, 5)
  ok(list === null, `全是垃圾时应回 null，实际 ${JSON.stringify(list)}`)
}

// ── 5. 没有 hippocampus 时不能假装成功 ────────────────────
{
  const b = createBridge(() => null)
  const r = b.annotate({ kind: '委屈', brief: '没人收' })
  ok(r.memory === 'skip', `没接上记忆时 memory 应为 skip，实际 ${r.memory}`)
  ok(r.noted === true, '本地账本仍应记下（离线兜底）')
  const t = b.writebackTruth()
  ok(t.attempted === 0, `没接上时不该计 attempted，实际 ${t.attempted}`)
}

try { rmSync(home, { recursive: true, force: true }) } catch { /* ignore */ }

if (fails.length) {
  console.log(`FAIL ${fails.length}:`)
  for (const f of fails) console.log(` - ${f}`)
  process.exit(1)
}
console.log('PASS 写回对账（成功/失败/未接三种都如实）+ recentEpisodes 挡情绪条 + valence null 语义')
process.exit(0)
