// 注意层：丘脑门控 / 顶叶定向 / 凸显网络 / 窄化 / 黏着 / 脱离。覆盖 N01-N06。
//
// 修的两个死字段：
//   · target 从来没人写（初始化 'chat' 之后一路到死），N02 定向等于没接。
//   · focus 只有"新异 = 长度差"这一根输入，同一长度的一句话反复说就钉在 0.4，
//     而且高唤醒/高显著（该收窄的时候）完全不参与 —— N04 窄化只写进 narrowing，进不了 focus。
//
// 现在：focus 朝"这一拍该盯多紧"的目标值收敛（3 分钟量级），
//       没人说话就落回一个稳定的静息值（不是 0，也不是拍数衰减）；
//       target 按"这一拍最抢眼的是什么"改写，安静久了才飘到旧事上。

import { clamp, decay } from '../core/consts.js'

// 冲她来的难听话：这时候注意力是被"那句话"钉住的
const STING = /垃圾|废物|蠢|闭嘴|没用|离谱|白痴|滚|重写|搞砸|行不行|做的什么|干的什么/

export function create(cfg = {}) {
  const P = {
    tauFocus: 3,     // focus 收敛时间常数（分钟）
    idleFocus: 0.22, // 没人说话时的静息注意力
  }
  const p = { ...P, ...cfg }

  const fresh = () => ({
    gate: 1, focus: 0.4, salienceNet: 0.2,
    narrowing: 0, sticky: 0, onBody: 0.3,
    target: 'chat', frame: 0,
  })
  let s = fresh()

  return {
    id: 'attention',
    cover: ['N01', 'N02', 'N03', 'N04', 'N05', 'N06'],
    step(w) {
      const dt = w.tx.dtMs
      const amy = w.get('amygdala')
      const hyp = w.get('hypothalamus')
      const soc = w.get('social')
      const ctx = w.context || {}
      const events = Array.isArray(w.tx.events) ? w.tx.events : []
      const threat = clamp(amy?.threat ?? 0, 0, 1)
      const arousal = clamp(0.5 * threat + 0.5 * (hyp?.hpa?.cortisol ?? 0), 0, 1)
      const novelty = clamp(amy?.novelty ?? 0, 0, 1)
      const salience = clamp(amy?.salience ?? 0, 0, 1)
      const other = clamp(soc?.otherFelt ?? 0, 0, 1)

      const hasUser = events.some(e => e.type === 'user')
      const hasAny = events.length > 0
      const said = events.filter(e => e.type === 'user').map(e => String(e.text || '')).join(' ')
      const sting = hasUser && STING.test(said)

      // N01 门控：高唤醒时过滤无关信息
      s.gate = clamp(1 - 0.5 * arousal, 0.3, 1)
      // N03 凸显网络：高显著事件打断
      s.salienceNet = clamp(salience * s.gate, 0, 1)

      // N02 定向 + N04 窄化：这一拍该盯多紧
      // 显著/唤醒越高，focus 越集中；没人说话就落回静息值
      let focusTarget = p.idleFocus
      if (hasUser) {
        focusTarget = clamp(0.30 + 0.30 * salience + 0.25 * threat + 0.20 * novelty, 0, 1)
      } else if (hasAny) {
        focusTarget = 0.40   // 她自己在说/在做事，注意力还在话上
      }
      const k = 1 - Math.exp(-(dt / 60_000) / Math.max(0.1, p.tauFocus))
      s.focus = clamp(s.focus + (focusTarget - s.focus) * k, 0, 1)

      // N04 窄化：高情绪时只看得见坏的（narrowing 是"视野"，focus 是"聚光"）
      const feltIn = clamp(Number(w.get('insula')?.felt?.intensity ?? 0), 0, 1)
      s.narrowing = clamp(0.6 * threat + 0.25 * arousal + 0.3 * feltIn + 0.10 * novelty, 0, 1)

      // N05 黏着：生气时越想越气；P18 自上而下能把它拉回来一点
      const topDown = w.get('pfc')?.topDown ?? 0.5
      s.sticky = clamp(s.sticky * decay(dt, 20) + 0.4 * threat * (1 - (w.get('pfc')?.bandwidth ?? 0.6)) * (1 - 0.3 * topDown), 0, 1)
      // N06 脱离：换件事做 / 接一句不是冲她来的话，黏着会松一截（10 分钟内回落）
      // P18 自上而下注意：带宽够的时候，能把注意从"那句话"上拉回来。
      const calmTurn = hasUser && !sting && !(threat > 0.45)
      if (events.some(e => e.type === 'activity')) s.sticky *= 0.7
      if (calmTurn || events.some(e => e.type === 'activity')) s.sticky *= (1 - 0.5 * topDown)

      // 对身体注意的比例（岛叶精度用）
      s.onBody = clamp(0.2 + 0.4 * s.sticky + 0.3 * s.narrowing, 0, 1)

      // ── N02 定向对象：这一拍最抢眼的是什么 ──
      // 以前这个字段没人写。它不参与情绪合成，但它是"她在看哪"的答案：
      // 面板、/affect/live 的社会层叙述、以后要接的输出通道都读它。
      if (hasUser) {
        if (sting || threat > 0.45) s.target = '他那句话'
        else if (other > 0.3) s.target = '他的状态'
        else if (salience > 0.45 || novelty > 0.6) s.target = '新出现的动静'
        else if (Number(ctx.question ?? 0) > 0) s.target = '这个问题'
        else if (Number(ctx.praise ?? 0) > 0) s.target = '他那句好话'
        else s.target = '他说的这件事'
      } else if (events.some(e => e.type === 'activity')) {
        s.target = '手头这事'
      } else if (Number(w.gapMs ?? 0) >= 600_000) {
        s.target = '脑子里的旧事'   // 没人说话十分钟以上，注意自己飘走了
      }
      // 其余情况保持上一拍的定向，别每一拍都重置回 'chat'

      s.frame += 1
    },
    read() {
      return {
        frame: s.frame,
        gate: s.gate, focus: s.focus, salienceNet: s.salienceNet,
        narrowing: s.narrowing, sticky: s.sticky, onBody: s.onBody, target: s.target,
      }
    },
    snapshot: () => ({ ...s }),
    restore(o) { if (o) s = { ...fresh(), ...o } },
    health: () => ({ ok: true, degraded: false, frame: s.frame }),
  }
}
