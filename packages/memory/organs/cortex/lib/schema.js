// 统一 cell 数据模型（F02 微柱同构）。
// cell 是索引/锚点，不是内容本体（R13）；内容在特征权重层和证据链里。
import { clamp } from './util.js'

export const SCHEMA_VERSION = 1

export function newCellId() {
  return `c_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}

export function cellKey(cell) {
  return [cell.subject || '', cell.predicate || '', cell.object || ''].join('|').toLowerCase()
}

export function makeCell(partial = {}) {
  const now = Date.now()
  return {
    id: partial.id || newCellId(),
    v: 1,
    schemaVersion: SCHEMA_VERSION,
    kind: partial.kind || 'fact',
    zone: partial.zone || 'concept',
    layer: partial.layer || 'semantic',
    subject: partial.subject || '',
    predicate: partial.predicate || '',
    object: partial.object || '',
    text: partial.text || '',
    tags: partial.tags || [],
    featureIds: partial.featureIds || [],
    anchors: partial.anchors || [],
    supportIds: partial.supportIds || [],
    confidence: clamp(partial.confidence ?? 0.5, 0, 1),
    source: partial.source || 'inferred',
    state: partial.state || 'hypothesis',
    evidenceCount: partial.evidenceCount ?? 1,
    firstSeen: partial.firstSeen ?? now,
    lastSeen: partial.lastSeen ?? now,
    order: partial.order ?? 0,
    level: partial.level || 'instance',
    weight: partial.weight ?? 1,
    salience: partial.salience ?? 0.5,
    biasFlag: Boolean(partial.biasFlag),
    evidenceFlag: Boolean(partial.evidenceFlag),
    retracted: Boolean(partial.retracted),
    archived: Boolean(partial.archived),
    tier: partial.tier || 'hot',
    transferState: partial.transferState || 'held',
    version: partial.version ?? 1,
    updatedAt: now,
  }
}

/** 读盘后的归一化：老数据缺字段就补上，不炸。 */
export function normalizeCell(row) {
  const c = makeCell(row)
  c.id = row.id || c.id
  c.version = row.version ?? 1
  c.updatedAt = row.updatedAt ?? row.lastSeen ?? c.updatedAt
  return c
}

export function touch(cell, patch = {}) {
  Object.assign(cell, patch)
  cell.version = (cell.version || 1) + 1
  cell.updatedAt = Date.now()
  return cell
}

export function clone(cell) {
  return JSON.parse(JSON.stringify(cell))
}
