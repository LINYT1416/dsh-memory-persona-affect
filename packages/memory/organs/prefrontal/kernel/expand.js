// #P1-5 查询扩写：同义/别名/错字。
// 词表是长期维护成本：扩错方向比不扩更糟，所以默认只加不减、最多 3 个变体。
export const DICT = {
  饭: ['吃饭', '外卖', '做饭'],
  吃饭: ['饭', '外卖', '下馆子'],
  地铁: ['通勤', '上下班'],
  加班: ['忙', '赶工'],
  老板: ['领导', '上司'],
  难受: ['不舒服', '疼'],
  高兴: ['开心', '爽'],
  生气: ['烦', '火大'],
  钱: ['工资', '花销'],
  猫: ['猫猫', '小猫'],
  狗: ['狗狗', '小狗'],
  医院: ['看病', '挂号'],
  考试: ['面试', '笔试'],
  游戏: ['打游戏', '开黑'],
}

const MAX_VARIANTS = 3

export function expand(q, dict = DICT) {
  const s = String(q ?? '')
  const out = []
  for (const [k, vs] of Object.entries(dict)) {
    if (!s.includes(k)) continue
    for (const v of vs) {
      if (s.includes(v)) continue
      out.push(s.split(k).join(v))
      if (out.length >= MAX_VARIANTS) return dedupe(out)
    }
  }
  return dedupe(out)
}

function dedupe(list) {
  return [...new Set(list)].slice(0, MAX_VARIANTS)
}

/** 扩写后的多串交给海马做多路召回（宿主决定要不要用）。 */
export function variants(q, dict) {
  const base = String(q ?? '')
  return [base, ...expand(base, dict)]
}
