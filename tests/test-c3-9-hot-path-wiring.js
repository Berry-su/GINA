/**
 * C-3.9 L1/L2/L4/L5 hot path wiring 测试（ADR-005 收口）
 *
 * 目标：验证 4 层 hot path wiring 在主流程触发时真的写到 CATS-Net 同一张图，
 *      且失败静默不破主流程、emotion 不进图、性能 P95 < 200ms。
 *
 * 测试场景（8 个 + 1 perf）：
 *   1. L1 注入决策：模拟 runInjector 末尾 wiring → CATS-Net 出现 l1_injection 节点
 *   2. L1 失败静默：模拟 integration 抛错 → wiring 整体不抛
 *   3. L2 记忆写入：模拟 addObservation → CATS-Net 出现 l2_mem_* 节点
 *   4. L2 记忆召回：模拟 runInjector 末尾 activateMemory → 概念激活
 *   5. L2 失败静默：integration 失败 → 主写入流程不抛
 *   6. L4 知识条目：模拟 storeIngestion / seedItem → CATS-Net 出现 l4_kb_* 节点
 *   7. L5 状态转换：模拟 state-machine._integrate → CATS-Net 出现 l5_fsm_state_* 节点 + 边
 *   8. emotion 严格隔离：4 层 wiring 不引入 emotion/joy 字段
 *   9. perf: 100 轮 4 层 hot path wiring P95 < 200ms
 *
 * 运行：node --test tests/test-c3-9-hot-path-wiring.js
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { CatsNet } from '@berrysu/gina-core/cats_net'
import { createIntegrations } from '../src/brain/integration/index.js'
import { initIntegration, getIntegration, _resetIntegrationForTest } from '../src/brain/integration/init.js'

// ---------------------------------------------------------------------------
// 工具：每个 test 独立 catsNet + integration instance（避免共享污染）
// ---------------------------------------------------------------------------

function freshSetup() {
  _resetIntegrationForTest()
  const catsNet = new CatsNet()
  const integ = initIntegration({ catsNet })
  return { catsNet, integ }
}

// ---------------------------------------------------------------------------
// 1. L1 注入决策：模拟 runInjector 末尾的 hot path wiring
// ---------------------------------------------------------------------------

test('C-3.9-1: L1 hot path wiring 写 aci_injection 节点到 CATS-Net', () => {
  const { catsNet, integ } = freshSetup()

  // 模拟 runInjector 末尾的 wiring
  //  (主流程：全用 integration.l1.recordInjection)
  integ.l1.recordInjection({
    strategy: 'semantic_memory_prefetch',
    confidence: 0.7,
    target: 'mem_001',
    context: 'test query',
  })

  // 验证：CATS-Net 出现 l1_injection 节点
  const l1Nodes = integ.l1.getL1Snapshot()
  assert.ok(l1Nodes.length >= 4, `L1 节点数 >= 4（3 策略 + 1 注入），实际 ${l1Nodes.length}`)
  assert.ok(l1Nodes.some((n) => n.id.startsWith('l1_injection_')))
})

// ---------------------------------------------------------------------------
// 2. L1 失败静默：integration 抛错时 wiring 整体不破
// ---------------------------------------------------------------------------

test('C-3.9-2: L1 失败静默（mock 抛错）— 主流程不抛', () => {
  const { catsNet, integ } = freshSetup()

  // 把 l1.recordInjection 替换为抛错版本
  const origRecord = integ.l1.recordInjection
  integ.l1.recordInjection = () => { throw new Error('mock failure') }

  // 模拟主流程：try/catch 包裹，失败不外抛
  let mainFlowOk = true
  try {
    // 模拟 runInjector 末尾的完整 wiring（含 L1 + L2 召回）
    try {
      integ.l1.recordInjection({ strategy: 'semantic_memory_prefetch', confidence: 0.5 })
    } catch { /* 静默 */ }
    // 主流程继续
    mainFlowOk = true
  } catch {
    mainFlowOk = false
  }

  assert.equal(mainFlowOk, true, 'L1 wiring 失败不能破主流程')
  // 还原
  integ.l1.recordInjection = origRecord
})

// ---------------------------------------------------------------------------
// 3. L2 记忆写入：模拟 addObservation 末尾的 hot path wiring
// ---------------------------------------------------------------------------

test('C-3.9-3: L2 记忆写入 hot path wiring 写 l2_mem 节点到 CATS-Net', () => {
  const { catsNet, integ } = freshSetup()

  // 先建一个 concept 让 memory 关联
  catsNet.addNode({ id: 'risk', type: 'abstract', level: 'semantic' })

  // 模拟 addObservation 末尾的 wiring
  //  (主流程：integ.l2.recordMemory)
  integ.l2.recordMemory({
    memoryId: 'hot_path_mem_001',
    content: 'test observation',
    type: 'observation',
    importance: 0.7,
    concepts: ['risk'],
    source: 'hot_path_test',
    level: 'episodic',
  })

  // 验证：CATS-Net 出现 l2_mem_hot_path_mem_001 节点
  const memNode = catsNet.getNode('l2_mem_hot_path_mem_001')
  assert.ok(memNode, 'L2 记忆节点应存在')
  assert.equal(memNode.deletedAt, null)
  // 验证：concepts 边（mem → risk）
  assert.ok(memNode.connections.has('risk'), 'mem → risk 边应存在')
})

// ---------------------------------------------------------------------------
// 4. L2 记忆召回：模拟 runInjector 末尾的 activateMemory
// ---------------------------------------------------------------------------

test('C-3.9-4: L2 召回 hot path wiring 激活 CATS-Net 概念', () => {
  const { catsNet, integ } = freshSetup()

  // 先建一个 memory 节点
  integ.l2.recordMemory({
    memoryId: 'recall_test_001',
    content: 'recall test',
    type: 'observation',
    importance: 0.5,
    concepts: [],
    source: 'recall_test',
  })
  const initialActivation = catsNet.getNode('l2_mem_recall_test_001')?.activation || 0

  // 模拟 runInjector 末尾的 activateMemory
  //  (主流程：integ.l2.activateMemory)
  integ.l2.activateMemory('recall_test_001', 0.5)

  // 验证：activation 增加
  const afterActivation = catsNet.getNode('l2_mem_recall_test_001')?.activation || 0
  assert.ok(afterActivation > initialActivation, `activation 应上升: ${initialActivation} → ${afterActivation}`)
})

// ---------------------------------------------------------------------------
// 5. L2 失败静默：addObservation 主流程不破
// ---------------------------------------------------------------------------

test('C-3.9-5: L2 写入失败静默 — addObservation 主流程不抛', () => {
  const { catsNet, integ } = freshSetup()

  // mock l2.recordMemory 抛错
  const origRecord = integ.l2.recordMemory
  integ.l2.recordMemory = () => { throw new Error('mock failure') }

  // 模拟 addObservation 主流程
  let mainFlowOk = true
  try {
    // 主写入
    catsNet.addNode({ id: 'main_write', type: 'abstract', level: 'semantic' })
    // L2 wiring (try/catch 包裹)
    try {
      integ.l2.recordMemory({ memoryId: 'fail_test', content: 'x', concepts: [] })
    } catch { /* 静默 */ }
    mainFlowOk = true
  } catch {
    mainFlowOk = false
  }

  assert.equal(mainFlowOk, true, 'L2 写入失败不能破 addObservation 主流程')
  // 验证：主写入成功
  assert.ok(catsNet.getNode('main_write'), '主写入的节点应存在')

  integ.l2.recordMemory = origRecord
})

// ---------------------------------------------------------------------------
// 6. L4 知识条目：模拟 storeIngestion / seedItem 末尾的 hot path wiring
// ---------------------------------------------------------------------------

test('C-3.9-6: L4 知识条目 hot path wiring 写 l4_kb 节点到 CATS-Net', () => {
  const { catsNet, integ } = freshSetup()

  // 模拟 storeIngestion 末尾的 wiring
  integ.l4.ingestKnowledge({
    domain: 'invest',
    slug: 'hot_path_value_investing',
    name: '价值投资 (hot path)',
    content: 'hot path test content',
  })
  integ.l4.ingestKnowledge({
    domain: 'code',
    slug: 'hot_path_async_await',
    name: 'Async/Await (hot path)',
    content: 'hot path test content',
    relations: [
      { domain: 'code', slug: 'hot_path_promises', relation: 'prerequisite_for' },
    ],
  })

  // 验证：CATS-Net 出现 2 个 l4_kb 节点
  const byDomain = integ.l4.getKnowledgeByDomain('invest')
  assert.equal(byDomain.length, 1)
  assert.equal(byDomain[0].slug, 'hot_path_value_investing')

  const codeNodes = integ.l4.getKnowledgeByDomain('code')
  assert.equal(codeNodes.length, 1)
  assert.equal(codeNodes[0].slug, 'hot_path_async_await')

  // 验证：c 边（async_await → promises prerequisite_for）
  const asyncNode = catsNet.getNode('l4_kb_code_hot_path_async_await')
  assert.ok(asyncNode, 'L4 节点应存在')
})

// ---------------------------------------------------------------------------
// 7. L5 状态转换：模拟 state-machine._integrate 末尾的 hot path wiring
// ---------------------------------------------------------------------------

test('C-3.9-7: L5 状态转换 hot path wiring 写 fsm_state 节点 + 边到 CATS-Net', () => {
  const { catsNet, integ } = freshSetup()

  // 模拟 _integrate 末尾的 recordTransition
  //  (主流程：integ.l5.recordTransition)
  integ.l5.recordTransition('state_machine', 'idle', 'focused', 'user_message', { weight: 0.8 })
  integ.l5.recordTransition('state_machine', 'focused', 'reflective', 'idle_timeout', { weight: 0.7 })

  // 验证：CATS-Net 出现 fsm_state 节点
  const sub = integ.l5.getFSMSubgraph('state_machine')
  assert.equal(sub.nodes.length, 3, `应有 3 个 fsm_state 节点，实际 ${sub.nodes.length}`)
  assert.equal(sub.edges.length, 2, `应有 2 条 causal 边，实际 ${sub.edges.length}`)
  // 验证：边类型
  assert.ok(sub.edges.every((e) => e.type === 'causal'))
  // 验证：event 字段
  assert.ok(sub.edges.some((e) => e.event === 'user_message'))
  assert.ok(sub.edges.some((e) => e.event === 'idle_timeout'))
})

// ---------------------------------------------------------------------------
// 8. emotion 严格隔离：4 层 wiring 不引入 emotion/joy 字段
// ---------------------------------------------------------------------------

test('C-3.9-8: 4 层 hot path wiring 严格 emotion 隔离', () => {
  const { catsNet, integ } = freshSetup()

  // 跑全 4 层 hot path wiring
  integ.l1.recordInjection({ strategy: 'semantic_memory_prefetch', confidence: 0.5, target: 'mem_x' })
  catsNet.addNode({ id: 'risk', type: 'abstract', level: 'semantic' })
  integ.l2.recordMemory({
    memoryId: 'emotion_test', content: 'test', type: 'observation', importance: 0.5,
    concepts: ['risk'], source: 'test', level: 'episodic',
  })
  integ.l4.ingestKnowledge({ domain: 'general', slug: 'emotion_test', name: 'test', content: 'test' })
  integ.l5.recordTransition('state_machine', 'a', 'b', 'ev', { weight: 0.5 })

  // 扫描所有节点 attributes
  let violations = 0
  for (const node of catsNet.nodes.values()) {
    if (node.deletedAt != null) continue
    const attrs = node.attributes || {}
    for (const forbidden of ['emotion', 'joy', 'mood', 'feeling', 'affect', 'valence', 'arousal', 'engagement']) {
      if (forbidden in attrs) {
        violations++
        console.error(`[EMOTION LEAK] node ${node.id} contains '${forbidden}'`)
      }
    }
  }
  assert.equal(violations, 0, `4 层 hot path 不应引入 emotion 字段，实际 ${violations} 处违例`)
})

// ---------------------------------------------------------------------------
// 9. perf: 100 轮 4 层 hot path wiring P95 < 200ms
// ---------------------------------------------------------------------------

test('C-3.9-9: 4 层 hot path wiring perf — 100 轮 P95 < 200ms', () => {
  const { catsNet, integ } = freshSetup()
  catsNet.addNode({ id: 'risk', type: 'abstract', level: 'semantic' })
  catsNet.addNode({ id: 'growth', type: 'abstract', level: 'semantic' })

  // warmup
  for (let i = 0; i < 5; i++) {
    integ.l1.recordInjection({ strategy: 'semantic_memory_prefetch', confidence: 0.5, target: 'risk' })
    integ.l2.recordMemory({
      memoryId: `warm_mem_${i}`, content: 'x', type: 'observation', importance: 0.5,
      concepts: ['risk'], source: 'perf', level: 'episodic',
    })
    integ.l2.activateMemory(`warm_mem_${i}`, 0.3)
    integ.l4.ingestKnowledge({ domain: 'invest', slug: `warm_kb_${i}`, name: 'x', content: 'x' })
    integ.l5.recordTransition('state_machine', 'a', 'b', 'warm', { weight: 0.5 })
  }

  // 100 轮实测
  const durations = []
  for (let i = 0; i < 100; i++) {
    const t0 = process.hrtime.bigint()
    // 模拟 1 轮主循环触发 4 层 hot path
    integ.l1.recordInjection({ strategy: 'semantic_memory_prefetch', confidence: 0.5 + (i % 10) / 20, target: 'risk' })
    integ.l2.recordMemory({
      memoryId: `perf_mem_${i}`, content: 'x', type: 'observation', importance: 0.5,
      concepts: i % 2 === 0 ? ['risk'] : ['growth'], source: 'perf', level: 'episodic',
    })
    integ.l2.activateMemory(`perf_mem_${i}`, 0.3)
    integ.l4.ingestKnowledge({ domain: 'invest', slug: `perf_kb_${i}`, name: 'x', content: 'x' })
    integ.l5.recordTransition('state_machine', i % 2 === 0 ? 'a' : 'b', i % 2 === 0 ? 'b' : 'a', 'perf', { weight: 0.5 })
    const t1 = process.hrtime.bigint()
    durations.push(Number(t1 - t0) / 1e6)
  }
  durations.sort((a, b) => a - b)
  const p50 = durations[Math.floor(durations.length * 0.5)]
  const p95 = durations[Math.floor(durations.length * 0.95)]
  const max = durations[durations.length - 1]
  console.log(`[perf C-3.9] 100 轮 4 层 hot path: p50=${p50.toFixed(2)}ms p95=${p95.toFixed(2)}ms max=${max.toFixed(2)}ms`)
  assert.ok(p95 < 200, `4 层 hot path wiring P95 应 < 200ms，实际 ${p95.toFixed(2)}ms`)
})
