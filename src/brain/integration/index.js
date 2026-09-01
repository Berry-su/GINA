/**
 * CATS-Net 8 层整合编排器 (C-3 · ADR-005)
 *
 * 统一暴露 7 层（L0~L7）的 integration helper + 跨层编排入口：
 *   - recordAll(ctx)              一站式写入
 *   - getBrainSnapshot()          全图快照
 *   - getGraphStats()             图统计
 *   - verifyCrossLayerConsistency() 跨层一致性检查
 *   - getL0() / getL1() / ...     单层访问
 *
 * 使用示例：
 *   import { createIntegrations } from '@berrysu/gina-core/cats_net' (CatsNet)
 *   import { createIntegrations } from './brain/integration/index.js' (本编排器)
 *   const ctx = createIntegrations({ catsNet, db, selfModel, ... })
 *   ctx.l0.tick({ consciousnessState: 'focused', tickCount: 42 })
 *   ctx.l6.recordCall('read_file', { success: true })
 *   const snap = ctx.getBrainSnapshot()
 */

import { IntegrationContext, getGraphStats, makeId } from './_base.js'
import L0Integration from './l0.js'
import L1Integration from './l1.js'
import L2Integration from './l2.js'
import L4Integration from './l4.js'
import L5Integration from './l5.js'
import L6Integration from './l6.js'
import L7Integration from './l7.js'

/**
 * 创建 7 层 integration 实例（一站式）
 * @param {object} options
 * @param {object} options.catsNet 必填
 * @param {object} [options.db] 可选
 * @param {object} [options.memory] 可选
 * @param {object} [options.embedding] 可选
 * @param {object} [options.knowledge] 可选
 * @param {object} [options.ingestion] 可选
 * @param {object} [options.capabilityRegistry] 可选
 * @param {object} [options.analysts] 可选
 * @param {object} [options.stateMachine] 可选
 * @param {object} [options.selfModel] 可选
 * @returns {object} 集成编排器
 */
export function createIntegrations(options = {}) {
  const ctx = new IntegrationContext(options)
  const integrations = {
    ctx,
    l0: new L0Integration(ctx),
    l1: new L1Integration(ctx),
    l2: new L2Integration(ctx),
    l4: new L4Integration(ctx),
    l5: new L5Integration(ctx),
    l6: new L6Integration(ctx),
    l7: new L7Integration(ctx),
  }

  /**
   * 跨层一致性检查
   * @returns {{ok: boolean, totalNodes: number, byLayer: object, byLevel: object, byType: object, recentEvents: Array, issues: Array<string>}}
   */
  function verifyCrossLayerConsistency() {
    const issues = []
    const stats = getGraphStats(ctx.catsNet)
    const byLayer = {
      L0: integrations.l0.getL0Snapshot().length,
      L1: integrations.l1.getL1Snapshot().length,
      L2: integrations.l2.getL2Snapshot().length,
      L4: integrations.l4.getL4Snapshot().length,
      L5: integrations.l5.getL5Snapshot().length,
      L6: integrations.l6.getL6Snapshot().length,
      L7: integrations.l7.getL7Snapshot().analysts.length + integrations.l7.getL7Snapshot().decisions.length,
    }
    // 节点数护栏
    if (byLayer.L0 > 200) issues.push(`L0 节点数 > 200: ${byLayer.L0}`)
    if (byLayer.L1 > 200) issues.push(`L1 节点数 > 200: ${byLayer.L1}`)
    if (byLayer.L4 > 1000) issues.push(`L4 节点数 > 1000: ${byLayer.L4}`)
    if (byLayer.L5 > 200) issues.push(`L5 节点数 > 200: ${byLayer.L5}`)
    if (byLayer.L6 > 500) issues.push(`L6 节点数 > 500: ${byLayer.L6}`)
    if (stats.total > 5000) issues.push(`全图节点数 > 5000: ${stats.total}`)

    // emotion 字段检查（隔离红线）
    for (const node of ctx.catsNet.nodes.values()) {
      if (node.deletedAt != null) continue
      const attrs = node.attributes || {}
      if ('emotion' in attrs || 'joy' in attrs) {
        issues.push(`节点 ${node.id} 含 emotion/joy 字段（隔离红线破坏）`)
        break
      }
    }

    return {
      ok: issues.length === 0,
      totalNodes: stats.total,
      byLayer,
      byLevel: stats.byLevel,
      byType: stats.byType,
      recentEvents: ctx._events.slice(-20),
      issues,
    }
  }

  /**
   * 全图快照
   * @returns {object}
   */
  function getBrainSnapshot() {
    return {
      stats: getGraphStats(ctx.catsNet),
      l0: integrations.l0.getL0Snapshot(),
      l1: integrations.l1.getL1Snapshot(),
      l2: integrations.l2.getL2Snapshot(),
      l4: integrations.l4.getL4Snapshot(),
      l5: integrations.l5.getL5Snapshot(),
      l6: integrations.l6.getL6Snapshot(),
      l7: integrations.l7.getL7Snapshot(),
      recentEvents: ctx._events.slice(-50),
    }
  }

  /**
   * 一站式写入（按 ctx._oneShot 字段决定）
   * @param {object} payload
   */
  function recordAll(payload = {}) {
    if (payload.l0) integrations.l0.tick(payload.l0)
    if (payload.l0SelfModel) integrations.l0.syncSelfModel(payload.l0SelfModel)
    if (payload.l0Awakening) integrations.l0.recordAwakening(payload.l0Awakening)
    if (payload.l1) {
      integrations.l1.recordInjection(payload.l1)
    }
    if (payload.l2) {
      integrations.l2.recordMemory(payload.l2)
    }
    if (payload.l4) {
      integrations.l4.ingestKnowledge(payload.l4)
    }
    if (payload.l5) {
      if (payload.l5.state) {
        integrations.l5.recordState(payload.l5.fsmId || 'main', payload.l5.state.stateId, payload.l5.state.options || {})
      }
      if (payload.l5.transition) {
        integrations.l5.recordTransition(
          payload.l5.fsmId || 'main',
          payload.l5.transition.from,
          payload.l5.transition.to,
          payload.l5.transition.event,
          payload.l5.transition.options || {},
        )
      }
    }
    if (payload.l6) {
      if (payload.l6.register) integrations.l6.registerTool(payload.l6.register)
      if (payload.l6.call) integrations.l6.recordCall(payload.l6.call.name, payload.l6.call.options || {})
    }
    if (payload.l7) {
      // registerAnalysts 接受 boolean (true = 用 default) 或 array
      if (payload.l7.registerAnalysts) {
        if (Array.isArray(payload.l7.registerAnalysts)) {
          integrations.l7.registerAnalysts(payload.l7.registerAnalysts)
        } else {
          integrations.l7.registerAnalysts()
        }
      }
      if (payload.l7.analystOutput) integrations.l7.recordAnalystOutput(payload.l7.analystOutput)
      if (payload.l7.decision) integrations.l7.recordDecision(payload.l7.decision)
    }
  }

  return {
    ...integrations,
    verifyCrossLayerConsistency,
    getBrainSnapshot,
    recordAll,
  }
}

export {
  IntegrationContext,
  L0Integration,
  L1Integration,
  L2Integration,
  L4Integration,
  L5Integration,
  L6Integration,
  L7Integration,
  getGraphStats,
  makeId,
}

export default createIntegrations
