// 假器官：五种状态，用来证明「接得进去」这件事本身成立。
export function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms))
}

export function makeEpisodes(base = Date.now() - 3 * 60 * 60 * 1000) {
  const mk = (i, text, extra = {}) => ({
    id: `ep_${i}`,
    v: 1,
    start: base + i * 60 * 1000,
    end: base + i * 60 * 1000 + 30 * 1000,
    summary: text,
    keywords: [],
    entities: [],
    anchor: { sessionId: 's1' },
    state: 'closed',
    version: 1,
    ...extra,
  })
  return [
    mk(0, '我的B站uid是1000003，昵称叫示例主人'),
    mk(1, '对了我的uid还是1000003'),
    mk(2, '我喜欢喝拿铁'),
    mk(3, '我喜欢喝美式'),
    mk(4, '我喜欢吃火锅'),
    mk(5, '我妈叫王芳'),
    mk(6, '我在楼下便利店买了瓶水'),
    mk(7, '今天把报表搞定了'),
    mk(8, '我的手机号是13800000000'),
    mk(9, '我的手机号还是13800000000'),
    mk(10, '我的手机号是13900000000'),
    mk(11, '我的生日是3月14日'),
  ]
}

export function makeHippocampus(state = 'normal', episodes = makeEpisodes()) {
  if (state === 'absent') return null
  const base = {
    v: 1,
    episodes: async ({ since = 0, limit = 200 } = {}) => episodes.filter((e) => e.start >= since).slice(-limit),
    traces: async () => [{ episodeId: 'ep_0', at: Date.now() }, { episodeId: 'ep_2', at: Date.now() }],
    quiet: async () => true,
    on: () => () => {},
  }
  if (state === 'stub') return { v: 1, episodes: async () => [] }
  if (state === 'slow') {
    return { ...base, episodes: async (args) => { await sleep(500); return base.episodes(args) } }
  }
  if (state === 'wrongVersion') return { ...base, v: 2 }
  return base
}

export function makePrefrontal(state = 'normal') {
  if (state === 'absent') return null
  if (state === 'stub') return { v: 1 }
  return {
    v: 1,
    plan: async () => ({ intent: 'ask', mode: 'separate', filters: {} }),
    verify: async () => ({ accepted: [], rejected: [], reasons: [] }),
    truthfulness: async (text) => ({ score: String(text).includes('不') ? 0.2 : 0.8, reason: 'fake', v: 1 }),
    resolveConflict: async () => ({ winner: 'neither', reason: 'fake' }),
    shouldRemember: async () => ({ ok: true, reason: 'fake' }),
  }
}

export function makeAmygdala(state = 'normal') {
  if (state === 'absent') return null
  if (state === 'stub') return { v: 1 }
  return {
    v: 1,
    salience: async () => ({ score: 0.9, arousal: 0.6, source: 'real', reason: 'fake' }),
    priority: async () => ({ score: 0.8, reason: 'fake' }),
  }
}
