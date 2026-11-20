// 面板字段完整性：index 传进来的每个"状态依赖"，snapshot 里都必须能看见。
// 这条测试是为了防我自己——同一个错（传了依赖、忘了在 snapshot 里读）已经犯了三次。
import { createPanel } from '../panel.js'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const fails = []
const ok = (c, m, d = '') => { if (!c) { fails.push(m + ' — ' + d); console.log('FAIL ' + m + (d ? ' — ' + d : '')) } }

const home = mkdtempSync(join(tmpdir(), 'panel-fields-'))
const engine = { read: () => ({ reads: {}, hex: {} }), snapshot: () => ({}) }

const SENTINEL = {
  relation: { debt: 1, intimacy: 0.7, turns: 9 },
  goals: { pending: [], done: 2, failed: 1 },
  conflicts: 3,
  possess: { jealousy: 0.4, hits: 2 },
  crave: { counts: { coffee: { n: 2, last: 1 } }, saidAt: 0 },
  worth: { value: 0.42, praise: 1, criticism: 2 },
  habit: { cues: { coffee: { days: ['2026-11-01'], last: 1 } } },
  keyPeriod: { hits: [1, 2, 3], markedAt: 5 },
  consistency: { stances: { '今晚出门': { value: '不去', at: 1 } } },
  identity: { filled: true, facts: { name: '大肥鱼' } },
  speakers: { seen: { u1: { count: 2 } }, main: 'u1' },
  storyline: { filled: true, points: 2 },
  interlocutor: { filled: true, name: '示例用户' },
  ritual: { done: { goodnight: '2026-11-19' } },
  reciprocity: { owed: 2, entries: [] },
  majorEvent: { events: [{ impact: 0.9, what: '那件事', at: 1 }] },
  ostracism: { streak: 3, ignored: 1 },
}

const panel = createPanel({
  home,
  engine,
  clamp: (v, a, b) => Math.min(b, Math.max(a, v)),
  setPersona: () => {},
  relation: () => SENTINEL.relation,
  goals: () => SENTINEL.goals,
  conflicts: () => SENTINEL.conflicts,
  possess: () => SENTINEL.possess,
  crave: () => SENTINEL.crave,
  worth: () => SENTINEL.worth,
  habit: () => SENTINEL.habit,
  keyPeriod: () => SENTINEL.keyPeriod,
  consistency: () => SENTINEL.consistency,
  identity: () => SENTINEL.identity,
  speakers: () => SENTINEL.speakers,
  storyline: () => SENTINEL.storyline,
  interlocutor: () => SENTINEL.interlocutor,
  ritual: () => SENTINEL.ritual,
  reciprocity: () => SENTINEL.reciprocity,
  majorEvent: () => SENTINEL.majorEvent,
  ostracism: () => SENTINEL.ostracism,
})

const snap = panel.snapshot()

// 每个传进来的状态，snapshot 都要原样透出
for (const key of Object.keys(SENTINEL)) {
  ok(snap[key] !== undefined && snap[key] !== null, 'snapshot 缺少字段: ' + key, JSON.stringify(snap[key]))
}

ok(snap.worth && snap.worth.value === 0.42, 'worth 值不对', JSON.stringify(snap.worth))
ok(snap.habit && snap.habit.cues, 'habit 值不对', JSON.stringify(snap.habit))
ok(snap.keyPeriod && snap.keyPeriod.markedAt === 5, 'keyPeriod 值不对', JSON.stringify(snap.keyPeriod))

// 值也要对（不是随便塞个占位）
ok(snap.conflicts === 3, 'conflicts 值不对', String(snap.conflicts))
ok(snap.possess && snap.possess.jealousy === 0.4, 'possess 值不对', JSON.stringify(snap.possess))
ok(snap.crave && snap.crave.counts && snap.crave.counts.coffee, 'crave 值不对', JSON.stringify(snap.crave))
ok(snap.goals && snap.goals.done === 2, 'goals 值不对', JSON.stringify(snap.goals))
ok(snap.relation && snap.relation.intimacy === 0.7, 'relation 值不对', JSON.stringify(snap.relation))
ok(typeof snap.conflicts === 'number', 'conflicts 必须是数', String(snap.conflicts))
ok(snap.identity && snap.identity.facts && snap.identity.facts.name === '大肥鱼', 'identity 值不对', JSON.stringify(snap.identity))
ok(snap.interlocutor && snap.interlocutor.name === '示例用户', 'interlocutor 值不对', JSON.stringify(snap.interlocutor))
ok(snap.speakers && snap.speakers.main === 'u1', 'speakers 值不对', JSON.stringify(snap.speakers))
ok(snap.storyline && snap.storyline.points === 2, 'storyline 值不对', JSON.stringify(snap.storyline))
ok(snap.ritual && snap.ritual.done && snap.ritual.done.goodnight, 'ritual 值不对', JSON.stringify(snap.ritual))
ok(snap.consistency && snap.consistency.stances, 'consistency 值不对', JSON.stringify(snap.consistency))
ok(snap.reciprocity && snap.reciprocity.owed === 2, 'reciprocity 值不对', JSON.stringify(snap.reciprocity))
ok(snap.majorEvent && snap.majorEvent.events && snap.majorEvent.events.length === 1, 'majorEvent 值不对', JSON.stringify(snap.majorEvent))
ok(snap.ostracism && snap.ostracism.streak === 3, 'ostracism 值不对', JSON.stringify(snap.ostracism))

if (fails.length) {
  console.log('\n提示：在 panel.js 的 snapshot() 里加对应字段，不要只在 index.js 传依赖。')
  process.exit(1)
}
console.log('PASS 面板字段完整性（reciprocity/majorEvent/relation/goals/conflicts/possess/crave/worth/habit/keyPeriod/consistency/identity/speakers/storyline/interlocutor/ritual 全部透出，值也对）')
