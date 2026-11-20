// 自动维护：人睡着了也会把当天的事归档，不该等人手点"结算"。
// 这里只做调度与顺序：先关段（settle），再蒸馏（consolidate）。
export const EVERY_MS = 15 * 60 * 1000
export const IDLE_MS = 5 * 60 * 1000

/**
 * @param {{settle?:Function, consolidate?:Function}} svc 海马体服务（可能不存在）
 * @param {{now?:number, lastAt?:number, everyMs?:number}} opt
 * @returns {{ran:boolean, settled:any, distilled:any, reason:string}}
 */
export function maintain(svc, opt = {}) {
  const now = Number(opt.now) || Date.now()
  const lastAt = Number(opt.lastAt) || 0
  const every = Number(opt.everyMs) || EVERY_MS
  if (now - lastAt < every) return { ran: false, settled: null, distilled: null, reason: 'not-due' }
  if (!svc || typeof svc !== 'object') return { ran: false, settled: null, distilled: null, reason: 'no-service' }
  if (typeof svc.settle !== 'function' && typeof svc.consolidate !== 'function') {
    return { ran: false, settled: null, distilled: null, reason: 'no-method' }
  }
  let settled = null
  let distilled = null
  try { if (typeof svc.settle === 'function') settled = svc.settle({ idleMs: Number(opt.idleMs) || IDLE_MS }) } catch { settled = null }
  try { if (typeof svc.consolidate === 'function') distilled = svc.consolidate({ mode: 'shallow' }) } catch { distilled = null }
  return { ran: true, settled, distilled, reason: 'ok' }
}
