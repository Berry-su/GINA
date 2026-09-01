/**
 * CATS-Net 8 层整合基础工具 (C-3)
 *
 * 提供跨层共享的 id 命名规则、节点创建 helper、防重复机制、salience 默认值。
 *
 * 设计原则（ADR-005 §3.1~§3.7）：
 *   - 每个层都通过 catsNet.addNode + connect 写图，不直接操作 SQLite
 *   - id 命名规则：`l<L>_<concept>_<discriminator>`，可被 grep / 可视化
 *   - 防重复：upsertNode 内部检查存在性，已有则更新 attributes
 *   - emotion 字段严格隔离：所有 helper 接受 emotion 参数时忽略
 *
 * @module src/cats_net/integration/_base
 */

import { CatsNet } from '../cats-net.js'

/**
 * 8 层的 id 前缀（固定，方便 grep）
 */
export const LAYER_PREFIX = Object.freeze({
  L0: 'l0',
  L1: 'l1',
  L2: 'l2',
  L3: 'l3',
  L4: 'l4',
  L5: 'l5',
  L6: 'l6',
  L7: 'l7',
})

/**
 * 8 层概念类型默认值
 */
export const LAYER_CONCEPT_DEFAULTS = Object.freeze({
  L0: { type: 'attribute', level: 'abstract' },      // 状态/任务/SelfModel 维度
  L1: { type: 'action', level: 'semantic' },         // 注入决策
  L2: { type: 'entity', level: 'episodic' },         // 记忆节点
  L3: { type: 'entity', level: 'semantic' },         // 基础概念（CATS-Net 内部）
  L4: { type: 'abstract', level: 'semantic' },       // 知识条目
  L5: { type: 'attribute', level: 'abstract' },      // 状态机状态
  L6: { type: 'action', level: 'semantic' },         // 工具
  L7: { type: 'relation', level: 'abstract' },       // 决策
})

/**
 * 跨层隔离红线（C-4 老板拍板）：emotion 字段**绝不**进 CATS-Net 节点化
 * @type {string[]}
 */
export const FORBIDDEN_NODE_ATTRS = Object.freeze([
  'emotion', 'joy', 'mood', 'feeling', 'affect',
  'valence', 'arousal', 'engagement',
])

/**
 * 清理 attributes，移除 emotion 相关字段
 * @param {object} attrs
 * @returns {object}
 */
export function sanitizeAttrs(attrs) {
  if (!attrs || typeof attrs !== 'object') return {}
  const out = {}
  for (const [k, v] of Object.entries(attrs)) {
    if (FORBIDDEN_NODE_ATTRS.includes(k)) continue
    if (typeof v === 'number' || typeof v === 'string') {
      out[k] = v
    }
  }
  return out
}

/**
 * upsertNode：节点已存在则更新 attributes，不存在则 addNode
 * 跳过软删除节点（保留证据，可恢复）
 * @param {CatsNet} catsNet
 * @param {string} id
 * @param {object} options
 * @param {string} [options.type]
 * @param {string} [options.level]
 * @param {object} [options.attributes]
 * @param {number} [options.activation]
 * @param {number} [options.confidence]
 * @returns {object} 节点
 */
export function upsertNode(catsNet, id, options = {}) {
  if (!catsNet || !id) return null
  const existing = catsNet.getNode(id)
  const attrs = sanitizeAttrs(options.attributes || {})
  if (existing) {
    if (existing.deletedAt != null) {
      // 软删除节点：只更新 attributes，不复活（保留 deletedAt）
      Object.assign(existing.attributes, attrs)
      existing._record?.({ op: 'integrationUpdate', layer: options._layer })
      return existing
    }
    // 在线节点：合并 attributes（patch 语义）
    if (options.attributes) {
      Object.assign(existing.attributes, attrs)
    }
    if (options.activation != null) {
      existing.activate(options.activation, `integration:${options._layer || 'unknown'}`)
    }
    if (options.confidence != null) {
      existing.confidence = Math.max(0, Math.min(1, options.confidence))
    }
    existing._record?.({ op: 'integrationPatch', layer: options._layer })
    return existing
  }
  // 新建节点
  const def = options._layer ? LAYER_CONCEPT_DEFAULTS[options._layer] : null
  return catsNet.addNode({
    id,
    name: options.name || id,
    type: options.type || def?.type || 'abstract',
    level: options.level || def?.level || 'semantic',
    attributes: attrs,
    activation: options.activation || 0,
    confidence: options.confidence != null ? options.confidence : 1.0,
  })
}

/**
 * safeConnect：建立 / 更新边，不重复添加
 * @param {CatsNet} catsNet
 * @param {string} fromId
 * @param {string} toId
 * @param {number} [weight=1.0]
 * @param {string} [type='association']
 * @param {boolean} [bidirectional=false]
 * @returns {boolean} 是否成功
 */
export function safeConnect(catsNet, fromId, toId, weight = 1.0, type = 'association', bidirectional = false) {
  if (!catsNet) return false
  const from = catsNet.getNode(fromId)
  const to = catsNet.getNode(toId)
  if (!from || !to) return false
  if (from.deletedAt != null || to.deletedAt != null) return false
  // 不允许自连接
  if (fromId === toId) return false
  // 已存在则更新 weight
  from.connect(toId, Math.max(0, Math.min(1, weight)), type, bidirectional)
  if (bidirectional) {
    to.connect(fromId, Math.max(0, Math.min(1, weight)), type, false)
  }
  return true
}

/**
 * 构造层内一致 id
 * @param {string} layer L0~L7
 * @param {string} kind concept 类型（e.g. 'state', 'tool', 'decision'）
 * @param {string} discriminator 唯一标识
 * @returns {string}
 */
export function makeId(layer, kind, discriminator) {
  return `${LAYER_PREFIX[layer] || 'lx'}_${kind}_${discriminator}`
}

/**
 * 集成层上下文：注入 catsNet + 共享状态
 */
export class IntegrationContext {
  /**
   * @param {object} options
   * @param {CatsNet} options.catsNet 必填
   * @param {object} [options.db] 可选；某些层需要 SQLite（l1 log / l2 索引）
   * @param {object} [options.memory] 可选；L2 双向桥
   * @param {object} [options.embedding] 可选；L2 自动绑概念
   * @param {object} [options.knowledge] 可选；L4 ingestion
   * @param {object} [options.capabilityRegistry] 可选；L6 工具注册
   * @param {object} [options.analysts] 可选；L7 决策 record
   * @param {object} [options.stateMachine] 可选；L5 状态机 hook
   * @param {object} [options.selfModel] 可选；L0 SelfModel 同步
   */
  constructor(options = {}) {
    if (!options.catsNet) {
      throw new TypeError('IntegrationContext 需要 catsNet')
    }
    this.catsNet = options.catsNet
    this.db = options.db || null
    this.memory = options.memory || null
    this.embedding = options.embedding || null
    this.knowledge = options.knowledge || null
    this.capabilityRegistry = options.capabilityRegistry || null
    this.analysts = options.analysts || null
    this.stateMachine = options.stateMachine || null
    this.selfModel = options.selfModel || null
    /** @type {Map<string, {ts:number, layer:string, op:string}>} 集成层事件 trace */
    this._events = []
    /** @type {Map<string, number> 各层节点数统计 */
    this._stats = new Map()
  }

  /**
   * 记录一次集成事件（用于调试 + C-3.8 测试断言）
   * @param {string} layer
   * @param {string} op
   * @param {object} [payload]
   */
  trace(layer, op, payload) {
    this._events.push({ ts: Date.now(), layer, op, payload })
    if (this._events.length > 1000) this._events.shift()
  }

  /**
   * 统计某层节点数（实时扫 CATS-Net）
   * @param {string} layer
   * @returns {number}
   */
  countLayer(layer) {
    const prefix = `l${layer.replace(/^L/, '').toLowerCase()}_`
    let n = 0
    for (const node of this.catsNet.nodes.values()) {
      if (node.deletedAt != null) continue
      if (node.id.startsWith(prefix)) n += 1
    }
    return n
  }

  /**
   * 增加某层节点数
   * @param {string} layer
   */
  bumpLayer(layer) {
    this._stats.set(layer, (this._stats.get(layer) || 0) + 1)
  }
}

/**
 * 跨层一致性检查（C-3.8 用）
 * @param {CatsNet} catsNet
 * @returns {{total:number, byLevel:object, byType:object}}
 */
export function getGraphStats(catsNet) {
  if (!catsNet) return { total: 0, byLevel: {}, byType: {} }
  const byLevel = { episodic: 0, semantic: 0, abstract: 0 }
  const byType = { entity: 0, abstract: 0, relation: 0, action: 0, attribute: 0 }
  let total = 0
  for (const node of catsNet.nodes.values()) {
    if (node.deletedAt != null) continue
    total += 1
    if (byLevel[node.level] != null) byLevel[node.level] += 1
    if (byType[node.type] != null) byType[node.type] += 1
  }
  return { total, byLevel, byType }
}
