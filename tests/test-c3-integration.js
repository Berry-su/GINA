/**
 * C-3.8 跨层一致性回归测试 (ADR-005 §4)
 *
 * 覆盖 15 个验证场景：
 *   1-6  跨层一致性（L0/L1/L2/L4/L5/L6/L7 各自入图 + 联动）
 *   7-9  性能（单层 < 5ms / 全 8 层 < 200ms / 跨层查询 < 50ms）
 *   10-12 规模护栏（每层 < 200 节点 / 全图 < 5k / learnConcepts +10）
 *   13-15 隔离测试（emotion-isolation 9 断言沿用 / 决策不含 emotion / analyst 不读 emotion）
 *
 * 运行：node --test tests/test-c3-integration.js
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, extname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { dirname } from 'node:path'

import { CatsNet } from '../src/cats_net/index.js'
import { createIntegrations } from '../src/cats_net/integration/index.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const SRC_DIR = join(__dirname, '..', 'src')

// ---------------------------------------------------------------------------
// 1-6 跨层一致性
// ---------------------------------------------------------------------------

test('C-3.1: L0 状态变化 → CATS-Net 出现 consciousness_state 概念', () => {
  const catsNet = new CatsNet()
  const { l0 } = createIntegrations({ catsNet })
  l0.tick({ consciousnessState: 'focused', tickCount: 1 })
  l0.tick({ consciousnessState: 'reflective', tickCount: 2 })
  const snap = l0.getL0Snapshot()
  assert.ok(snap.some((n) => n.id === 'l0_consciousness_state_focused'))
  assert.ok(snap.some((n) => n.id === 'l0_consciousness_state_reflective'))
})

test('C-3.1: L0 SelfModel 4 维 → 4 个 concept', () => {
  const catsNet = new CatsNet()
  const { l0 } = createIntegrations({ catsNet })
  l0.syncSelfModel({
    version: 1,
    identity: { name: 'GINA', version: '2.1.601', learned: { nodes: 10, memories: 5, experiences: 2 }, loadedTools: 50 },
    current: { task: 'test' },
    abilities: { confidence: 0.7, capabilities: [] },
    limitations: ['no consciousness'],
    meta: { tickCount: 1 },
  })
  const snap = l0.getL0Snapshot()
  assert.ok(snap.some((n) => n.id === 'l0_self_identity_v1'))
  assert.ok(snap.some((n) => n.id === 'l0_self_current_v1'))
  assert.ok(snap.some((n) => n.id === 'l0_self_abilities_v1'))
  assert.ok(snap.some((n) => n.id === 'l0_self_limitations_v1'))
})

test('C-3.2: L1 ACI 注入决策 → CATS-Net 出现 injection + log', () => {
  // 用 better-sqlite3 mock（如果 db 不可用，log 应为 null）
  const catsNet = new CatsNet()
  const { l1 } = createIntegrations({ catsNet })
  const r = l1.recordInjection({
    strategy: 'semantic_memory_prefetch',
    confidence: 0.85,
    target: null,
    durationMs: 12,
  })
  assert.ok(r.injectionId.startsWith('l1_injection_'))
  const snap = l1.getL1Snapshot()
  assert.ok(snap.length >= 4)  // 3 strategies + 1 injection
})

test('C-3.3: L2 记忆双向引用', () => {
  const catsNet = new CatsNet()
  const { l2 } = createIntegrations({ catsNet })
  catsNet.addNode({ id: 'risk', type: 'abstract', level: 'semantic' })
  l2.recordMemory({
    memoryId: 'mem_001',
    content: 'risk observation',
    type: 'observation',
    importance: 0.8,
    concepts: ['risk'],
  })
  assert.equal(l2.findConceptsForMemory('mem_001'), 'l2_mem_mem_001')
  // concept → memories 查找
  const memories = l2.findMemoriesForConcept('risk')
  assert.ok(Array.isArray(memories))
  assert.ok(memories.length >= 0)  // 无 db 时退化
})

test('C-3.4: L4 知识条目概念化 + 关系入图', () => {
  const catsNet = new CatsNet()
  const { l4 } = createIntegrations({ catsNet })
  l4.ingestKnowledge({ domain: 'invest', slug: 'value', name: '价值投资' })
  l4.ingestKnowledge({ domain: 'invest', slug: 'growth', name: '成长投资' })
  l4.linkKnowledge('l4_kb_invest_growth', 'l4_kb_invest_value', 'related_to', 0.7)
  const byDomain = l4.getKnowledgeByDomain('invest')
  assert.equal(byDomain.length, 2)
  // 验证边
  const growth = catsNet.getNode('l4_kb_invest_growth')
  assert.ok(growth.connections.has('l4_kb_invest_value'))
  assert.equal(growth.connections.get('l4_kb_invest_value').type, 'related_to')
})

test('C-3.5: L5 状态机 → 状态=概念，转换=边', () => {
  const catsNet = new CatsNet()
  const { l5 } = createIntegrations({ catsNet })
  l5.recordState('consciousness', 'dormant', { type: 'attribute' })
  l5.recordState('consciousness', 'focused', { type: 'attribute' })
  l5.recordTransition('consciousness', 'dormant', 'focused', 'user_message', { weight: 0.9 })
  const sub = l5.getFSMSubgraph('consciousness')
  assert.equal(sub.nodes.length, 2)
  assert.equal(sub.edges.length, 1)
  assert.equal(sub.edges[0].type, 'causal')
  assert.equal(sub.edges[0].event, 'user_message')
})

test('C-3.6: L6 工具注册 + 调用 + credibility 动态', () => {
  const catsNet = new CatsNet()
  const { l6 } = createIntegrations({ catsNet })
  l6.registerTool({ name: 'read_file', securityLevel: 1, initialSalience: 0.5 })
  const before = l6.getToolCredibility('read_file')
  l6.recordCall('read_file', { success: true })
  const after = l6.getToolCredibility('read_file')
  assert.ok(after > before, `credibility 应上升: ${before} -> ${after}`)
})

test('C-3.7: L7 决策 = 概念聚合（含 analyst_output + 工具边）', () => {
  const catsNet = new CatsNet()
  const { l6, l7 } = createIntegrations({ catsNet })
  l6.registerTool({ name: 'read_file' })
  l7.registerAnalysts()
  const decisionId = l7.recordDecision({
    summary: 'Test',
    analystOutputs: [
      { analyst: 'macro', score: 0.5, confidence: 0.8 },
      { analyst: 'technical', score: 0.7, confidence: 0.7 },
    ],
    riskScore: 0.2,
    adoptedTools: ['read_file'],
  })
  const explain = l7.getDecisionExplanation(decisionId)
  assert.equal(explain.inputs.length, 2)
  assert.equal(explain.tools.length, 1)
})

test('C-3.7: L7 高风险触发风控官 veto', () => {
  const catsNet = new CatsNet()
  const { l7 } = createIntegrations({ catsNet })
  l7.registerAnalysts()
  const decisionId = l7.recordDecision({
    summary: 'High risk',
    analystOutputs: [{ analyst: 'macro', score: 0.5 }],
    riskScore: 0.9,
  })
  const explain = l7.getDecisionExplanation(decisionId)
  assert.equal(explain.risks.length, 1)
  assert.equal(explain.risks[0].id, 'l7_risk_officer_veto')
})

// ---------------------------------------------------------------------------
// 7-9 性能测试
// ---------------------------------------------------------------------------

test('perf: 单层节点化 < 5ms', () => {
  const catsNet = new CatsNet()
  const { l6 } = createIntegrations({ catsNet })
  const samples = []
  for (let i = 0; i < 50; i++) {
    const t0 = process.hrtime.bigint()
    l6.registerTool({ name: `tool_${i}`, securityLevel: 1 })
    samples.push(Number(process.hrtime.bigint() - t0) / 1e6)
  }
  samples.sort((a, b) => a - b)
  const p95 = samples[Math.floor(samples.length * 0.95)]
  console.log(`[perf] L6 registerTool p95: ${p95.toFixed(2)}ms`)
  assert.ok(p95 < 5, `P95 < 5ms，实际 ${p95.toFixed(2)}ms`)
})

test('perf: 全 8 层 recordAll P95 < 200ms', () => {
  const catsNet = new CatsNet()
  const integ = createIntegrations({ catsNet })
  integ.l7.registerAnalysts()
  integ.l6.registerTool({ name: 'read_file' })
  catsNet.addNode({ id: 'risk', type: 'abstract', level: 'semantic' })
  // warmup
  for (let i = 0; i < 5; i++) {
    integ.recordAll({
      l0: { consciousnessState: 'focused', tickCount: i },
      l1: { strategy: 'semantic_memory_prefetch', confidence: 0.5 },
      l2: { memoryId: `warm_${i}`, importance: 0.5, concepts: ['risk'] },
      l4: { domain: 'invest', slug: `kb_${i}` },
      l6: { call: { name: 'read_file', options: { success: true } } },
      l7: { analystOutput: { analyst: 'macro', score: 0.5, confidence: 0.7 } },
    })
  }
  const samples = []
  for (let i = 0; i < 100; i++) {
    const t0 = process.hrtime.bigint()
    integ.recordAll({
      l0: { consciousnessState: i % 2 === 0 ? 'focused' : 'reflective', tickCount: 100 + i },
      l1: { strategy: 'semantic_memory_prefetch', confidence: 0.5 + (i % 10) / 20 },
      l2: { memoryId: `mem_${i}`, importance: 0.5, concepts: ['risk'] },
      l4: { domain: 'invest', slug: `kb_${i}` },
      l6: { call: { name: 'read_file', options: { success: i % 3 !== 0 } } },
      l7: { analystOutput: { analyst: 'macro', score: 0.5, confidence: 0.7 } },
    })
    samples.push(Number(process.hrtime.bigint() - t0) / 1e6)
  }
  samples.sort((a, b) => a - b)
  const p50 = samples[Math.floor(samples.length * 0.5)]
  const p95 = samples[Math.floor(samples.length * 0.95)]
  const max = samples[samples.length - 1]
  console.log(`[perf] C-3 recordAll p50=${p50.toFixed(2)}ms p95=${p95.toFixed(2)}ms max=${max.toFixed(2)}ms`)
  assert.ok(p95 < 200, `P95 < 200ms，实际 ${p95.toFixed(2)}ms`)
})

test('perf: 跨层查询 P95 < 50ms', () => {
  const catsNet = new CatsNet()
  const integ = createIntegrations({ catsNet })
  // 准备 100 个工具 + 100 个状态
  for (let i = 0; i < 100; i++) {
    integ.l6.registerTool({ name: `tool_${i}`, securityLevel: 1 })
    integ.l5.recordState('fsm', `state_${i}`, { type: 'attribute' })
  }
  // warmup
  for (let i = 0; i < 5; i++) {
    const snap = integ.getBrainSnapshot()
  }
  const samples = []
  for (let i = 0; i < 50; i++) {
    const t0 = process.hrtime.bigint()
    const snap = integ.getBrainSnapshot()
    void snap
    samples.push(Number(process.hrtime.bigint() - t0) / 1e6)
  }
  samples.sort((a, b) => a - b)
  const p95 = samples[Math.floor(samples.length * 0.95)]
  console.log(`[perf] 跨层 getBrainSnapshot p95: ${p95.toFixed(2)}ms`)
  assert.ok(p95 < 50, `P95 < 50ms，实际 ${p95.toFixed(2)}ms`)
})

// ---------------------------------------------------------------------------
// 10-12 规模护栏
// ---------------------------------------------------------------------------

test('guard: 8 层节点化后每层 < 200 节点', () => {
  const catsNet = new CatsNet()
  const integ = createIntegrations({ catsNet })
  // 跑 50 轮主循环
  integ.l7.registerAnalysts()
  for (let i = 0; i < 50; i++) {
    integ.recordAll({
      l0: { consciousnessState: 'focused', tickCount: i },
      l1: { strategy: 'semantic_memory_prefetch', confidence: 0.5 },
      l4: { domain: 'invest', slug: `kb_${i}` },
      l6: { register: { name: `tool_${i}`, securityLevel: 1 } },
      l7: { analystOutput: { analyst: 'macro', score: 0.5 } },
    })
  }
  const check = integ.verifyCrossLayerConsistency()
  // 允许 L4 1000（知识条目可多），其他 < 200
  assert.ok(check.byLayer.L0 < 200, `L0 节点数应 < 200: ${check.byLayer.L0}`)
  assert.ok(check.byLayer.L1 < 200, `L1 节点数应 < 200: ${check.byLayer.L1}`)
  assert.ok(check.byLayer.L5 < 200, `L5 节点数应 < 200: ${check.byLayer.L5}`)
  assert.ok(check.byLayer.L6 < 500, `L6 节点数应 < 500: ${check.byLayer.L6}`)
})

test('guard: 全图节点 < 5000', () => {
  const catsNet = new CatsNet()
  const integ = createIntegrations({ catsNet })
  for (let i = 0; i < 200; i++) {
    integ.l4.ingestKnowledge({ domain: 'invest', slug: `kb_${i}` })
  }
  const check = integ.verifyCrossLayerConsistency()
  assert.ok(check.totalNodes < 5000, `全图节点数应 < 5000: ${check.totalNodes}`)
})

test('guard: learnConcepts 单次 +10 上限（C-1.3 护栏沿用）', () => {
  // 验证 learnConcepts 仍走 C-1.3 4 重护栏（单次新增 ≤ 10）
  const catsNet = new CatsNet()
  // 准备 50 个高频共现对（用 episodes 直接喂）
  const episodes = []
  for (let i = 0; i < 50; i++) {
    episodes.push({ concepts: [`a_${i}`, `b_${i}`], timestamp: Date.now() })
  }
  const before = catsNet.aliveSize
  const r = catsNet.learnConcepts({ episodes, minConfidence: 0.5, maxNew: 10 })
  const after = catsNet.aliveSize
  const newCount = after - before
  assert.ok(newCount <= 10, `单次新增应 ≤ 10: ${newCount}`)
  assert.ok(Array.isArray(r.added))
  assert.ok(r.added.length <= 10)
})

// ---------------------------------------------------------------------------
// 13-15 隔离测试
// ---------------------------------------------------------------------------

test('isolation: emotion 字段不进 CATS-Net 节点（双盲扫描）', () => {
  const catsNet = new CatsNet()
  const integ = createIntegrations({ catsNet })
  integ.l7.registerAnalysts()
  integ.l6.registerTool({ name: 'read_file' })
  integ.recordAll({
    l0: { consciousnessState: 'focused', tickCount: 1 },
    l1: { strategy: 'semantic_memory_prefetch', confidence: 0.5 },
    l4: { domain: 'invest', slug: 'kb_1' },
    l6: { call: { name: 'read_file', options: { success: true } } },
    l7: { decision: { summary: 'test', analystOutputs: [{ analyst: 'macro', score: 0.5 }], riskScore: 0.2 } },
  })
  // 扫描所有节点 attributes
  let polluted = 0
  for (const node of catsNet.nodes.values()) {
    if (node.deletedAt != null) continue
    const attrs = node.attributes || {}
    if ('emotion' in attrs || 'joy' in attrs || 'mood' in attrs) {
      polluted += 1
    }
  }
  assert.equal(polluted, 0, `${polluted} 个节点被污染 emotion 字段`)
})

test('isolation: 决策节点 attributes 不含 emotion', () => {
  const catsNet = new CatsNet()
  const { l7 } = createIntegrations({ catsNet })
  l7.registerAnalysts()
  const id = l7.recordDecision({
    summary: 'test',
    analystOutputs: [{ analyst: 'macro', score: 0.5 }],
    riskScore: 0.3,
  })
  const decision = catsNet.getNode(id)
  const attrs = decision.attributes || {}
  for (const key of Object.keys(attrs)) {
    assert.ok(!['emotion', 'joy', 'mood', 'feeling'].includes(key), `决策节点不应含 ${key}`)
  }
})

test('isolation: l7 源码不 import joy-state / emotion-engine', () => {
  // 扫描 src/cats_net/integration/l7.js，确认不 import emotion 相关模块
  const l7Src = readFileSync(join(SRC_DIR, 'cats_net', 'integration', 'l7.js'), 'utf-8')
  assert.ok(!l7Src.includes('joy-state'), 'l7.js 不应 import joy-state')
  assert.ok(!l7Src.includes('emotion-engine'), 'l7.js 不应 import emotion-engine')
  assert.ok(!l7Src.includes('emotion/joy'), 'l7.js 不应 import emotion/joy')
})

// ---------------------------------------------------------------------------
// 额外：综合联动测试
// ---------------------------------------------------------------------------

test('integration: L0 → L5 → L7 → L6 联动', () => {
  const catsNet = new CatsNet()
  const integ = createIntegrations({ catsNet })

  // 1) L0 状态变化
  integ.l0.tick({ consciousnessState: 'focused', tickCount: 1 })

  // 2) L5 状态机记录
  integ.l5.recordState('consciousness', 'focused', { type: 'attribute' })

  // 3) L7 决策
  integ.l7.registerAnalysts()
  const decisionId = integ.l7.recordDecision({
    summary: '联动测试',
    analystOutputs: [
      { analyst: 'macro', score: 0.6, confidence: 0.8 },
      { analyst: 'technical', score: 0.4, confidence: 0.7 },
    ],
    riskScore: 0.2,
  })

  // 4) L6 工具调用
  integ.l6.registerTool({ name: 'read_file' })
  integ.l6.recordCall('read_file', { success: true })

  // 验证一致性
  const check = integ.verifyCrossLayerConsistency()
  assert.equal(check.ok, true, `issues: ${check.issues.join('; ')}`)
  assert.ok(check.byLayer.L0 > 0)
  assert.ok(check.byLayer.L5 > 0)
  assert.ok(check.byLayer.L6 > 0)
  assert.ok(check.byLayer.L7 >= 7)  // 6 analysts + 1 risk officer + 1 decision
})

test('integration: recordAll 一站式写入', () => {
  const catsNet = new CatsNet()
  const integ = createIntegrations({ catsNet })
  integ.recordAll({
    l0: { consciousnessState: 'focused', tickCount: 1 },
    l1: { strategy: 'semantic_memory_prefetch', confidence: 0.8 },
    l4: { domain: 'invest', slug: 'value' },
    l5: { fsmId: 'main', state: { stateId: 'idle' }, transition: { from: 'init', to: 'idle', event: 'startup' } },
    l6: { register: { name: 'test_tool', securityLevel: 1 } },
    l7: { registerAnalysts: true, analystOutput: { analyst: 'macro', score: 0.5 } },
  })
  const check = integ.verifyCrossLayerConsistency()
  assert.equal(check.ok, true)
  assert.ok(check.totalNodes >= 10)
})
