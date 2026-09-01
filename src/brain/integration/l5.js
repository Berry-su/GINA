/**
 * C-3.5 L5 状态机 → CATS-Net 状态=概念，转换=边
 *
 * 把 FSM/HSM 的 state 注册为 CATS-Net concept，
 * transition 注册为带权边（type=causal）。
 *
 * 节点结构：
 *   - l5_fsm_state_<stateId>             每个状态（attribute 层）
 *   - l5_hsm_state_<parentId>            HSM 父状态（abstract 层）
 *   - 边：l5_fsm_state_<from> → l5_fsm_state_<to> (type=causal, weight=transitionProb)
 *
 * 触发点：
 *   - l5.recordState(...)                注册新 state
 *   - l5.recordTransition(...)           记录一次转换
 *   - l5.attach(fsm)                     挂到具体 FSM 实例，自动 hook transition
 *   - l5.getFSMSubgraph(fsmId)           返回子图（用于 3D 可视化）
 *
 * 情绪严格隔离：状态 attributes 不含 emotion 字段
 */

import { upsertNode, safeConnect, makeId, sanitizeAttrs } from './_base.js'

const LAYER = 'L5'

export class L5Integration {
  /**
   * @param {object} ctx IntegrationContext
   */
  constructor(ctx) {
    this.ctx = ctx
    this.catsNet = ctx.catsNet
    this.stateMachine = ctx.stateMachine || null
    /** @type {Map<string, number> fsmId → 已注册 state 数（去重） */
    this._fsmStateCount = new Map()
    /** @type {Map<string, number> fsmId → 已注册 transition 数（去重） */
    this._fsmTransCount = new Map()
  }

  /**
   * 注册一个 FSM state
   * @param {string} fsmId FSM 唯一标识（如 'consciousness_state'）
   * @param {string} stateId state 唯一标识
   * @param {object} [options]
   * @param {string} [options.name]
   * @param {string} [options.parent=null] HSM 父 state id
   * @param {string} [options.type='attribute'] attribute / abstract / entity
   * @returns {string} concept id
   */
  recordState(fsmId, stateId, options = {}) {
    if (!fsmId || !stateId) {
      throw new TypeError('recordState 需要 fsmId + stateId')
    }
    const { name = null, parent = null, type = 'attribute' } = options
    const id = makeId(LAYER, 'fsm_state', `${fsmId}_${stateId}`)
    // 映射 type 到合法 level（CONCEPT_LEVELS = ['episodic','semantic','abstract']）
    // type='attribute' → level='abstract'（FSM 状态是抽象概念）
    // type='abstract' → level='abstract'
    // type='entity' → level='semantic'
    const levelMap = { attribute: 'abstract', abstract: 'abstract', entity: 'semantic' }
    const safeType = ['attribute', 'abstract', 'entity'].includes(type) ? type : 'attribute'
    upsertNode(this.catsNet, id, {
      _layer: LAYER,
      name: name || `${fsmId}.${stateId}`,
      type: safeType,
      level: levelMap[safeType],
      attributes: sanitizeAttrs({
        fsmId,
        stateId,
        parent: parent || '',
        registeredAt: Date.now(),
      }),
    })
    // HSM 父子关系
    if (parent) {
      const parentId = makeId(LAYER, 'hsm_state', `${fsmId}_${parent}`)
      // 父状态也建一个
      upsertNode(this.catsNet, parentId, {
        _layer: LAYER,
        name: `${fsmId}.${parent} (parent)`,
        type: 'abstract',
        level: 'abstract',
        attributes: { fsmId, stateId: parent, isParent: true, registeredAt: Date.now() },
      })
      safeConnect(this.catsNet, parentId, id, 1.0, 'part_of', true)
    }
    this._fsmStateCount.set(fsmId, (this._fsmStateCount.get(fsmId) || 0) + 1)
    this.ctx.bumpLayer(LAYER)
    this.ctx.trace(LAYER, 'recordState', { fsmId, stateId, id })
    return id
  }

  /**
   * 记录一次 transition（边 = causal, weight = probability）
   * @param {string} fsmId
   * @param {string} fromId
   * @param {string} toId
   * @param {string} event
   * @param {object} [options]
   * @param {number} [options.weight=1.0]
   * @param {string} [options.guard=null]
   * @returns {boolean}
   */
  recordTransition(fsmId, fromId, toId, event, options = {}) {
    if (!fsmId || !fromId || !toId) {
      throw new TypeError('recordTransition 需要 fsmId + fromId + toId')
    }
    const { weight = 1.0, guard = null } = options
    const fromConcept = makeId(LAYER, 'fsm_state', `${fsmId}_${fromId}`)
    const toConcept = makeId(LAYER, 'fsm_state', `${fsmId}_${toId}`)

    // 确保 from/to state 节点存在
    this.recordState(fsmId, fromId, { type: 'attribute' })
    this.recordState(fsmId, toId, { type: 'attribute' })

    // 边：causal + 概率权重
    const ok = safeConnect(this.catsNet, fromConcept, toConcept, Math.max(0, Math.min(1, weight)), 'causal', false)
    if (ok) {
      // 边属性记录在 from 节点的 connections 元数据
      const from = this.catsNet.getNode(fromConcept)
      if (from) {
        const meta = from.connections.get(toConcept)
        if (meta) {
          meta.event = event
          meta.guard = guard || null
          meta.ts = Date.now()
        }
      }
      this._fsmTransCount.set(fsmId, (this._fsmTransCount.get(fsmId) || 0) + 1)
      this.ctx.trace(LAYER, 'recordTransition', { fsmId, fromId, toId, event })
    }
    return ok
  }

  /**
   * 挂到具体 FSM 实例（自动 hook transition 事件）
   * @param {object} fsm FSM/HSM/StateMachine 实例
   * @param {string} [fsmId='fsm'] 标识
   * @returns {() => void} 卸载函数
   */
  attach(fsm, fsmId = 'fsm') {
    if (!fsm) return () => {}
    const self = this
    // 兼容 FSM (currentState) 和 StateMachine (currentStateId / currentState)
    const getCurrent = () => fsm.currentState || fsm.currentStateId || null
    let last = getCurrent()

    // 注册初始 state
    if (last) {
      self.recordState(fsmId, last, { type: 'attribute' })
    }

    // 周期性检查（每轮主循环调一次）
    // 因为 FSM 没有 emit 事件，我们提供 checkTransition() 显式调
    fsm.__l5Integration_check = function (event = 'tick', newState = getCurrent()) {
      if (newState && newState !== last) {
        if (last) {
          self.recordTransition(fsmId, last, newState, event)
        }
        self.recordState(fsmId, newState, { type: 'attribute' })
        last = newState
        return true
      }
      return false
    }

    return () => {
      delete fsm.__l5Integration_check
    }
  }

  /**
   * 返回某 FSM 的子图
   * @param {string} fsmId
   * @returns {{nodes: Array, edges: Array}}
   */
  getFSMSubgraph(fsmId) {
    if (!fsmId) return { nodes: [], edges: [] }
    const prefix = makeId(LAYER, 'fsm_state', `${fsmId}_`)
    const hsmPrefix = makeId(LAYER, 'hsm_state', `${fsmId}_`)
    const nodes = []
    const edges = []
    for (const node of this.catsNet.nodes.values()) {
      if (node.deletedAt != null) continue
      if (!node.id.startsWith(prefix) && !node.id.startsWith(hsmPrefix)) continue
      nodes.push({
        id: node.id,
        name: node.name,
        level: node.level,
        type: node.type,
        fsmId: node.attributes?.fsmId,
        stateId: node.attributes?.stateId,
      })
      // 收集边
      for (const [targetId, meta] of node.connections) {
        if (!targetId.startsWith(prefix) && !targetId.startsWith(hsmPrefix)) continue
        edges.push({
          from: node.id,
          to: targetId,
          type: meta.type,
          weight: meta.weight,
          event: meta.event,
        })
      }
    }
    return { nodes, edges }
  }

  /**
   * 返回 L5 子图快照（全部 fsm，不限定）
   * @returns {Array}
   */
  getL5Snapshot() {
    const out = []
    for (const node of this.catsNet.nodes.values()) {
      if (node.deletedAt != null) continue
      if (!node.id.startsWith('l5_')) continue
      out.push({
        id: node.id,
        name: node.name,
        level: node.level,
        fsmId: node.attributes?.fsmId,
        stateId: node.attributes?.stateId,
      })
    }
    return out
  }
}

export default L5Integration
