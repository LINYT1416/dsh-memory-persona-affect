// 分层失效 + 亚核开关。
// 对应功能总表：A7-4 功能开关、A7-5 亚核开关、C10、R14。
//
// 亚核语义（对齐 4.1 / 4.7）：
//   bla 关 → 不学习、不增强、认不出威胁（= 双侧 BLA 损伤）
//   cea 关 → 不表达、不释放应激激素（cort 停，ne 继续）
//   itc 关 → 消退失效（gate 不起作用）
//   mea 关 → 社会信号不参与

export const FEATURES = [
  'score', 'tone', 'capture', 'fear', 'gate', 'fidelity', 'review', 'modulate', 'social',
]

export const NUCLEI = ['bla', 'cea', 'itc', 'mea']

export function makeSwitches() {
  const offFeatures = new Set()
  const offNuclei = new Set()

  return {
    /** 功能级：关掉只降级，不阻断链路。 */
    off: (name) => offFeatures.add(name),
    on: (name) => offFeatures.delete(name),
    isOff: (name) => offFeatures.has(name),

    /** 亚核级。 */
    nucleusOff: (name) => offNuclei.add(name),
    nucleusOn: (name) => offNuclei.delete(name),
    nucleusIsOff: (name) => offNuclei.has(name),

    /** 组合判断：功能开且关键亚核在。 */
    active(feature, nucleus) {
      if (offFeatures.has(feature)) return false
      if (nucleus && offNuclei.has(nucleus)) return false
      return true
    },

    list() {
      return {
        features: FEATURES.map((name) => ({ name, on: !offFeatures.has(name) })),
        nuclei: NUCLEI.map((name) => ({ name, on: !offNuclei.has(name) })),
      }
    },

    reset() {
      offFeatures.clear()
      offNuclei.clear()
    },
  }
}
