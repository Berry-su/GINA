/**
 * C-3 8 层整合 smoke test
 *
 * 验证 7 层 integration helper 全部能正常 addNode / connect / record
 * 不验证 8 层联动（那是 tests/test-c3-integration.js 的范围）
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { CatsNet } from '@berrysu/gina-core/cats_net'
import { createIntegrations } from './index.js'

// ---------------------------------------------------------------------------
test('L0 tick + syncSelfModel', () => {
  const catsNet = new CatsNet()
  const { l0, ctx } = createIntegrations({ catsNet })
  l0.tick({ consciousnessState: 'focused', tickCount: 42 })
  l0.syncSelfModel({
    version: 1,
    identity: { name: 'GINA', version: '2.1.601', bornAt: 1000, uptimeMs: 5000, learned: { nodes: 10, memories: 5, experiences: 2 }, loadedTools: 50 },
    current: { task: 'test', consciousnessState: 'focused', currentDirection: 'test' },
    abilities: { confidence: 0.7, capabilities: ['a', 'b'], recentFailures: [] },
    limitations: ['no subjective consciousness', 'no free will'],
    meta: { tickCount: 42 },
  })
  const snap = l0.getL0Snapshot()
  assert.ok(snap.length >= 4, `L0 节点数 >= 4，实际 ${snap.length}`)
  assert.ok(snap.some((n) => n.id === 'l0_self_identity_v1'))
  assert.ok(snap.some((n) => n.id === 'l0_self_current_v1'))
  assert.ok(snap.some((n) => n.id === 'l0_self_abilities_v1'))
  assert.ok(snap.some((n) => n.id === 'l0_self_limitations_v1'))
  assert.ok(snap.some((n) => n.id === 'l0_consciousness_state_focused'))
  assert.ok(ctx.countLayer('L0') >= 4)
})

test('L1 recordInjection + log stats (无 db)', () => {
  const catsNet = new CatsNet()
  const { l1 } = createIntegrations({ catsNet })
  const r1 = l1.recordInjection({ strategy: 'semantic_memory_prefetch', confidence: 0.8, target: null })
  assert.ok(r1.injectionId.startsWith('l1_injection_'))
  const r2 = l1.recordInjection({ strategy: 'tool_chain_prefetch', confidence: 0.6, target: null })
  assert.ok(r2.injectionId.startsWith('l1_injection_'))
  const snap = l1.getL1Snapshot()
  assert.ok(snap.length >= 5, `L1 节点数 >= 5（3 策略 + 2 注入），实际 ${snap.length}`)
  // 无 db 时 stats 应为 null
  assert.equal(l1.getInjectionStats(), null)
})

test('L2 recordMemory + getRecentMemories (无 db)', () => {
  const catsNet = new CatsNet()
  const { l2 } = createIntegrations({ catsNet })
  // 先建一个 concept 让 memory 关联
  catsNet.addNode({ id: 'risk', type: 'abstract', level: 'semantic' })
  const r = l2.recordMemory({
    memoryId: 'mem_001',
    content: 'test memory',
    type: 'observation',
    importance: 0.7,
    concepts: ['risk'],
    ts: Date.now(),
  })
  assert.ok(r.conceptId === 'l2_mem_mem_001')
  assert.equal(r.written, false)  // 无 db
  assert.equal(l2.findConceptsForMemory('mem_001'), 'l2_mem_mem_001')
  const snap = l2.getL2Snapshot()
  assert.equal(snap.length, 1)
  assert.equal(snap[0].memoryId, 'mem_001')
})

test('L4 ingestKnowledge + getKnowledgeByDomain', () => {
  const catsNet = new CatsNet()
  const { l4 } = createIntegrations({ catsNet })
  l4.ingestKnowledge({
    domain: 'invest',
    slug: 'value_investing',
    name: '价值投资',
    content: '寻找低于内在价值的股票',
  })
  l4.ingestKnowledge({
    domain: 'invest',
    slug: 'growth_investing',
    name: '成长投资',
    relations: [{ domain: 'invest', slug: 'value_investing', relation: 'related_to', weight: 0.7 }],
  })
  const byDomain = l4.getKnowledgeByDomain('invest')
  assert.equal(byDomain.length, 2)
  assert.ok(byDomain.some((n) => n.slug === 'value_investing'))
  assert.ok(byDomain.some((n) => n.slug === 'growth_investing'))
})

test('L5 recordState + recordTransition + getFSMSubgraph', () => {
  const catsNet = new CatsNet()
  const { l5 } = createIntegrations({ catsNet })
  l5.recordState('consciousness', 'dormant', { type: 'attribute' })
  l5.recordState('consciousness', 'focused', { type: 'attribute' })
  l5.recordState('consciousness', 'reflective', { type: 'attribute' })
  l5.recordTransition('consciousness', 'dormant', 'focused', 'user_message', { weight: 0.9 })
  l5.recordTransition('consciousness', 'focused', 'reflective', 'idle_timeout', { weight: 0.7 })
  const sub = l5.getFSMSubgraph('consciousness')
  assert.equal(sub.nodes.length, 3)
  assert.equal(sub.edges.length, 2)
  assert.ok(sub.edges.every((e) => e.type === 'causal'))
})

test('L6 registerTool + recordCall + credibility', () => {
  const catsNet = new CatsNet()
  const { l6 } = createIntegrations({ catsNet })
  l6.registerTool({ name: 'read_file', securityLevel: 1, category: 'fs' })
  l6.registerTool({ name: 'exec_command', securityLevel: 3, category: 'shell' })
  const beforeCred = l6.getToolCredibility('read_file')
  l6.recordCall('read_file', { success: true })
  const afterCred = l6.getToolCredibility('read_file')
  assert.ok(afterCred > beforeCred, `成功调用后 credibility 应上升: ${beforeCred} -> ${afterCred}`)
  // 失败
  l6.recordCall('read_file', { success: false })
  l6.recordCall('read_file', { success: false })
  const failedCred = l6.getToolCredibility('read_file')
  assert.ok(failedCred < afterCred, `失败调用后 credibility 应下降: ${afterCred} -> ${failedCred}`)
  // 分类查询
  const fsTools = l6.getToolsByCategory('fs')
  assert.equal(fsTools.length, 1)
  assert.equal(fsTools[0].securityLevel, 1)
})

test('L7 registerAnalysts + recordDecision + getDecisionExplanation', () => {
  const catsNet = new CatsNet()
  const { l6, l7 } = createIntegrations({ catsNet })
  l6.registerTool({ name: 'read_file', securityLevel: 1 })
  l7.registerAnalysts()
  const decisionId = l7.recordDecision({
    summary: 'Test decision: buy signal',
    analystOutputs: [
      { analyst: 'macro', score: 0.5, confidence: 0.8, reasoning: 'Macro supportive' },
      { analyst: 'technical', score: 0.7, confidence: 0.7, reasoning: 'Bullish pattern' },
      { analyst: 'attacker', score: -0.3, confidence: 0.5, reasoning: 'Overbought risk' },
    ],
    riskScore: 0.3,
    adoptedTools: ['read_file'],
    outcome: 'adopted',
  })
  assert.ok(decisionId.startsWith('l7_decision_'))
  const explain = l7.getDecisionExplanation(decisionId)
  assert.equal(explain.inputs.length, 3, `应有 3 个 analyst input，实际 ${explain.inputs.length}`)
  assert.equal(explain.tools.length, 1, `应有 1 个 tool，实际 ${explain.tools.length}`)
  // 风控官不应出现在低风险决策的 risks 里
  assert.equal(explain.risks.length, 0)
})

test('L7 high riskScore -> risk officer veto', () => {
  const catsNet = new CatsNet()
  const { l7 } = createIntegrations({ catsNet })
  l7.registerAnalysts()
  const decisionId = l7.recordDecision({
    summary: 'High risk decision',
    analystOutputs: [{ analyst: 'macro', score: 0.5 }],
    riskScore: 0.9,
  })
  const explain = l7.getDecisionExplanation(decisionId)
  assert.equal(explain.risks.length, 1, `高风险应触发风控官 veto`)
  assert.equal(explain.risks[0].id, 'l7_risk_officer_veto')
})

test('verifyCrossLayerConsistency: emotion 隔离', () => {
  const catsNet = new CatsNet()
  const integ = createIntegrations({ catsNet })
  // 写一些节点
  integ.l0.tick({ consciousnessState: 'focused', tickCount: 1 })
  integ.l1.recordInjection({ strategy: 'semantic_memory_prefetch', confidence: 0.5 })
  integ.l6.registerTool({ name: 'read_file' })
  integ.l7.registerAnalysts()
  integ.l7.recordDecision({
    summary: 'test',
    analystOutputs: [{ analyst: 'macro', score: 0.5 }],
  })
  const check = integ.verifyCrossLayerConsistency()
  // emotion 隔离：无 emotion 字段 → ok
  assert.equal(check.ok, true, `issues: ${check.issues.join('; ')}`)
  assert.ok(check.totalNodes >= 5)
})

test('verifyCrossLayerConsistency: 主动污染 emotion 字段 → 检测到', () => {
  const catsNet = new CatsNet()
  const integ = createIntegrations({ catsNet })
  // 主动污染一个节点
  catsNet.addNode({ id: 'malicious', type: 'abstract', level: 'semantic', attributes: { emotion: 'happy' } })
  const check = integ.verifyCrossLayerConsistency()
  assert.equal(check.ok, false)
  assert.ok(check.issues.some((i) => i.includes('emotion/joy 字段')))
})

test('integration layer performance: 100 轮 P95 < 200ms', () => {
  const catsNet = new CatsNet()
  const integ = createIntegrations({ catsNet })
  integ.l7.registerAnalysts()
  integ.l6.registerTool({ name: 'read_file' })
  const durations = []
  for (let i = 0; i < 100; i++) {
    const t0 = process.hrtime.bigint()
    integ.recordAll({
      l0: { consciousnessState: i % 2 === 0 ? 'focused' : 'reflective', tickCount: i },
      l1: { strategy: 'semantic_memory_prefetch', confidence: 0.5 + (i % 10) / 20 },
      l4: { domain: 'invest', slug: `kb_${i}`, name: `Knowledge ${i}` },
      l6: { call: { name: 'read_file', options: { success: i % 3 !== 0 } } },
      l7: {
        analystOutput: { analyst: 'macro', score: 0.5, confidence: 0.7 },
      },
    })
    const t1 = process.hrtime.bigint()
    durations.push(Number(t1 - t0) / 1e6)  // ms
  }
  durations.sort((a, b) => a - b)
  const p50 = durations[Math.floor(durations.length * 0.5)]
  const p95 = durations[Math.floor(durations.length * 0.95)]
  const max = durations[durations.length - 1]
  console.log(`[perf] 100 轮 recordAll: p50=${p50.toFixed(2)}ms p95=${p95.toFixed(2)}ms max=${max.toFixed(2)}ms`)
  assert.ok(p95 < 200, `P95 应该 < 200ms，实际 ${p95}ms`)
})
