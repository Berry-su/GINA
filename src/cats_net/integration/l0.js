/**
 * C-3.1 L0 意识循环 → CATS-Net 节点化
 *
 * 把 L0 主循环的状态（consciousnessState、当前任务、SelfModel 4 维）
 * 全部入 CATS-Net 同一张图。
 *
 * 节点结构：
 *   - l0_self_identity (abstract)         SelfModel 维度 1
 *   - l0_self_current (abstract)          SelfModel 维度 2
 *   - l0_self_abilities (abstract)        SelfModel 维度 3
 *   - l0_self_limitations (abstract)      SelfModel 维度 4
 *   - l0_consciousness_state_<state>      当前状态机状态
 *   - l0_tick_counter (attribute)         tick 计数
 *   - l0_current_task_<taskId>            当前任务（动态）
 *
 * 触发点：
 *   - l0.tick(state)        每轮 tick（仅 state 变化时 record，去重）
 *   - l0.syncSelfModel()    SelfModel tick 时调
 *   - l0.recordAwakening()  觉醒阶段切换时
 *
 * 情绪严格隔离：所有 attributes 经 _base.sanitizeAttrs 过滤 emotion 字段
 */

import { upsertNode, safeConnect, makeId, sanitizeAttrs } from './_base.js'

const LAYER = 'L0'

export class L0Integration {
  /**
   * @param {object} ctx IntegrationContext
   */
  constructor(ctx) {
    this.ctx = ctx
    this.catsNet = ctx.catsNet
    /** @type {string|null} 上次 state，去重 */
    this._lastState = null
    /** @type {string|null} 上次 taskId */
    this._lastTaskId = null
    /** @type {string|null} 上次觉醒阶段 */
    this._lastAwakeningPhase = null
  }

  /**
   * 每轮 tick 调（仅 state 变化时 record，去重）
   * @param {object} state 当前 L0 state
   * @param {string} [state.consciousnessState]
   * @param {string} [state.taskId]
   * @param {string} [state.taskSummary]
   * @param {number} [state.tickCount]
   * @returns {boolean} 是否有新写入
   */
  tick(state) {
    if (!state || typeof state !== 'object') return false
    const { catsNet } = this
    let changed = false

    // 1) tick 计数
    if (typeof state.tickCount === 'number') {
      upsertNode(catsNet, makeId(LAYER, 'tick_counter', 'v1'), {
        _layer: LAYER,
        name: 'L0 Tick Counter',
        activation: Math.min(1, state.tickCount / 10000),  // 10000 归一化
        attributes: { tickCount: state.tickCount, lastUpdatedAt: Date.now() },
      })
    }

    // 2) consciousness state（去重）
    if (state.consciousnessState && state.consciousnessState !== this._lastState) {
      const stateId = makeId(LAYER, 'consciousness_state', state.consciousnessState)
      upsertNode(catsNet, stateId, {
        _layer: LAYER,
        name: `意识状态: ${state.consciousnessState}`,
        type: 'attribute',
        level: 'abstract',
        attributes: { state: state.consciousnessState, lastEnteredAt: Date.now() },
      })
      // 自连接到 self_current
      upsertNode(catsNet, makeId(LAYER, 'self_current', 'v1'), {
        _layer: LAYER,
        name: 'L0 Self Current',
        type: 'attribute',
        level: 'abstract',
        attributes: { currentState: state.consciousnessState, lastUpdatedAt: Date.now() },
      })
      safeConnect(catsNet, makeId(LAYER, 'self_current', 'v1'), stateId, 1.0, 'contains', false)
      this._lastState = state.consciousnessState
      changed = true
    }

    // 3) current task（去重）
    if (state.taskId && state.taskId !== this._lastTaskId) {
      const taskId = makeId(LAYER, 'current_task', state.taskId)
      upsertNode(catsNet, taskId, {
        _layer: LAYER,
        name: state.taskSummary || `Task: ${state.taskId}`,
        type: 'action',
        level: 'episodic',
        attributes: { taskId: state.taskId, startedAt: Date.now() },
      })
      upsertNode(catsNet, makeId(LAYER, 'self_current', 'v1'), {
        _layer: LAYER,
        attributes: { currentTaskId: state.taskId, lastUpdatedAt: Date.now() },
      })
      safeConnect(catsNet, makeId(LAYER, 'self_current', 'v1'), taskId, 1.0, 'active_task', false)
      this._lastTaskId = state.taskId
      changed = true
    } else if (!state.taskId && this._lastTaskId) {
      // 任务结束：清理旧 task 节点的 active_task 边（不删节点，留痕）
      this._lastTaskId = null
    }

    if (changed) this.ctx.bumpLayer(LAYER)
    this.ctx.trace(LAYER, 'tick', { state, changed })
    return changed
  }

  /**
   * 同步 SelfModel 4 维到 CATS-Net
   * @param {object} snapshot SelfModel.snapshot() 结果
   */
  syncSelfModel(snapshot) {
    if (!snapshot || typeof snapshot !== 'object') return
    const { catsNet } = this
    const { _ } = { _base: { sanitizeAttrs } }
    const sanitize = sanitizeAttrs

    // 1) identity
    upsertNode(catsNet, makeId(LAYER, 'self_identity', 'v1'), {
      _layer: LAYER,
      name: 'L0 Self Identity',
      type: 'attribute',
      level: 'abstract',
      attributes: sanitize({
        name: snapshot.identity?.name,
        version: snapshot.identity?.version,
        coreVersion: snapshot.identity?.coreVersion,
        bornAt: snapshot.identity?.bornAt,
        uptimeMs: snapshot.identity?.uptimeMs,
        learnedNodes: snapshot.identity?.learned?.nodes,
        learnedMemories: snapshot.identity?.learned?.memories,
        learnedExperiences: snapshot.identity?.learned?.experiences,
        loadedTools: snapshot.identity?.loadedTools,
      }),
    })

    // 2) current
    upsertNode(catsNet, makeId(LAYER, 'self_current', 'v1'), {
      _layer: LAYER,
      name: 'L0 Self Current',
      type: 'attribute',
      level: 'abstract',
      attributes: sanitize({
        task: snapshot.current?.task,
        step: snapshot.current?.currentStep,
        consciousnessState: snapshot.current?.consciousnessState,
        agentRole: snapshot.current?.currentAgentRole,
        direction: snapshot.current?.currentDirection,
      }),
    })

    // 3) abilities
    upsertNode(catsNet, makeId(LAYER, 'self_abilities', 'v1'), {
      _layer: LAYER,
      name: 'L0 Self Abilities',
      type: 'attribute',
      level: 'abstract',
      attributes: sanitize({
        confidence: snapshot.abilities?.confidence,
        capabilitiesCount: snapshot.abilities?.capabilities?.length || 0,
        recentFailuresCount: snapshot.abilities?.recentFailures?.length || 0,
      }),
    })

    // 4) limitations
    const limitations = Array.isArray(snapshot.limitations) ? snapshot.limitations : []
    upsertNode(catsNet, makeId(LAYER, 'self_limitations', 'v1'), {
      _layer: LAYER,
      name: 'L0 Self Limitations',
      type: 'attribute',
      level: 'abstract',
      attributes: sanitize({
        list: limitations.join('|'),
        count: limitations.length,
      }),
    })

    // 边：abilities → identity, limitations → identity
    safeConnect(catsNet, makeId(LAYER, 'self_abilities', 'v1'), makeId(LAYER, 'self_identity', 'v1'), 1.0, 'belongs_to', false)
    safeConnect(catsNet, makeId(LAYER, 'self_limitations', 'v1'), makeId(LAYER, 'self_identity', 'v1'), 0.5, 'constrains', false)
    safeConnect(catsNet, makeId(LAYER, 'self_current', 'v1'), makeId(LAYER, 'self_identity', 'v1'), 1.0, 'belongs_to', false)

    this.ctx.bumpLayer(LAYER)
    this.ctx.trace(LAYER, 'syncSelfModel', { tickCount: snapshot.meta?.tickCount })
  }

  /**
   * 记录觉醒阶段切换
   * @param {string} phase 觉醒阶段名
   */
  recordAwakening(phase) {
    if (!phase || phase === this._lastAwakeningPhase) return
    const { catsNet } = this
    const phaseId = makeId(LAYER, 'awakening_phase', phase)
    upsertNode(catsNet, phaseId, {
      _layer: LAYER,
      name: `觉醒阶段: ${phase}`,
      type: 'attribute',
      level: 'abstract',
      attributes: { phase, enteredAt: Date.now() },
      activation: 1.0,
    })
    this._lastAwakeningPhase = phase
    this.ctx.bumpLayer(LAYER)
    this.ctx.trace(LAYER, 'recordAwakening', { phase })
  }

  /**
   * 返回 L0 子图快照
   * @returns {Array<{id:string, name:string, level:string, activation:number}>}
   */
  getL0Snapshot() {
    const out = []
    for (const node of this.catsNet.nodes.values()) {
      if (node.deletedAt != null) continue
      if (!node.id.startsWith('l0_')) continue
      out.push({
        id: node.id,
        name: node.name,
        level: node.level,
        type: node.type,
        activation: node.activation,
      })
    }
    return out
  }
}

export default L0Integration
