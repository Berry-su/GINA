#!/usr/bin/env node

/**
 * Gina 协议集成与工程化 - 全量验证测试
 * 
 * 验证模块:
 * 1. MCP Server - Gina 作为 MCP Server 暴露能力
 * 2. MCP Client Manager - 连接外部 MCP 服务器
 * 3. HITL - 审批工作流与干预机制
 * 4. 状态持久化 - 检查点管理
 * 5. A2A 协议 - Agent Card 与任务分发
 */

import { createGinaMcpServer, ginaHandlers } from './src/mcp/gina-mcp-server.js'
import { HttpMcpClientManager, presetMcpServers } from './src/mcp/http-client-manager.js'
import { createHitlSystem } from './src/hitl/hitl-system.js'
import { createCheckpointManager, TaskProgressTracker } from './src/persistence/checkpoint-manager.js'
import { createA2AServer, createA2AClient } from './src/a2a/a2a-protocol.js'

// 测试统计
const results = {
  total: 0,
  passed: 0,
  failed: 0,
  skipped: 0,
  details: [],
}

function log(level, message) {
  const timestamp = new Date().toISOString().split('T')[1].slice(0, 8)
  const prefix = {
    info: 'ℹ️',
    success: '✅',
    warning: '⚠️',
    error: '❌',
  }[level] || 'ℹ️'
  console.log(`${timestamp} ${prefix} ${message}`)
}

function test(name, fn) {
  results.total++
  try {
    const result = fn()
    // 如果函数执行成功且不返回 false，则通过
    if (result !== false && result !== null) {
      results.passed++
      results.details.push({ name, status: 'passed' })
      log('success', `PASS: ${name}`)
    } else {
      results.failed++
      results.details.push({ name, status: 'failed', reason: 'Returned false or null' })
      log('error', `FAIL: ${name}`)
    }
  } catch (err) {
    results.failed++
    results.details.push({ name, status: 'failed', reason: err.message })
    log('error', `FAIL: ${name} - ${err.message}`)
  }
}

function asyncTest(name, fn) {
  results.total++
  ;(async () => {
    try {
      const result = await fn()
      // 如果函数执行成功且不返回 false，则通过
      if (result !== false && result !== null) {
        results.passed++
        results.details.push({ name, status: 'passed' })
        log('success', `PASS: ${name}`)
      } else {
        results.failed++
        results.details.push({ name, status: 'failed', reason: 'Returned false or null' })
        log('error', `FAIL: ${name}`)
      }
    } catch (err) {
      results.failed++
      results.details.push({ name, status: 'failed', reason: err.message })
      log('error', `FAIL: ${name} - ${err.message}`)
    }
  })()
}

// ============================================================
// 测试开始
// ============================================================

console.log('\n============================================================')
console.log('  Gina 协议集成与工程化 - 全量验证测试')
console.log('============================================================\n')

// ------------------------------------------------------------
// Phase 1: MCP Server 测试
// ------------------------------------------------------------

log('info', '\n--- Phase 1: MCP Server ---')

test('1.1 创建 Gina MCP Server', () => {
  const server = createGinaMcpServer({
    name: 'test-gina',
    version: '1.0.0',
    handlers: ginaHandlers,
  })
  return server instanceof Object
})

test('1.2 注册 MCP Tools', () => {
  const server = createGinaMcpServer({ handlers: ginaHandlers })
  return server.registerGinaTools().length > 0
})

test('1.3 工具列表包含知识查询', () => {
  const server = createGinaMcpServer({ handlers: ginaHandlers })
  const tools = server.registerGinaTools()
  return tools.some(t => t.name === 'gina_query_knowledge')
})

test('1.4 工具列表包含研究分析', () => {
  const server = createGinaMcpServer({ handlers: ginaHandlers })
  const tools = server.registerGinaTools()
  return tools.some(t => t.name === 'gina_research_analyze')
})

test('1.5 工具列表包含决策分析', () => {
  const server = createGinaMcpServer({ handlers: ginaHandlers })
  const tools = server.registerGinaTools()
  return tools.some(t => t.name === 'gina_analyze_decision')
})

// ------------------------------------------------------------
// Phase 2: MCP Client Manager 测试
// ------------------------------------------------------------

log('info', '\n--- Phase 2: MCP Client Manager ---')

test('2.1 创建 HTTP MCP Client Manager', () => {
  const manager = new HttpMcpClientManager()
  return manager instanceof HttpMcpClientManager
})

test('2.2 预设服务器配置存在', () => {
  return Object.keys(presetMcpServers).length >= 4
})

test('2.3 GitHub MCP 预设存在', () => {
  return presetMcpServers.github !== undefined
})

asyncTest('2.4 搜索工具功能可用', async () => {
  const manager = new HttpMcpClientManager()
  const results = await manager.searchTools('test')
  return Array.isArray(results)
})

test('2.5 获取状态功能可用', () => {
  const manager = new HttpMcpClientManager()
  const status = manager.getStatus()
  return status.totalConnections === 0
})

// ------------------------------------------------------------
// Phase 3: HITL 人机协作测试
// ------------------------------------------------------------

log('info', '\n--- Phase 3: HITL 人机协作 ---')

test('3.1 创建 HITL 系统', () => {
  const hitl = createHitlSystem()
  return hitl.approvalWorkflow && hitl.interventionController
})

test('3.2 高风险操作需要审批', () => {
  const hitl = createHitlSystem()
  const action = { description: 'delete all data' }
  return hitl.approvalWorkflow.needsApproval(action) === true
})

test('3.3 查询操作不需要审批', () => {
  const hitl = createHitlSystem()
  const action = { description: 'query database' }
  return hitl.approvalWorkflow.needsApproval(action) === false
})

test('3.4 提交审批请求', () => {
  const hitl = createHitlSystem()
  const action = { type: 'data_deletion', description: 'delete records' }
  const approval = hitl.approvalWorkflow.requestApproval(action, 'test-user')
  return approval.id && approval.status === 'pending'
})

test('3.5 批准审批', () => {
  const hitl = createHitlSystem()
  const action = { type: 'high_risk', description: 'dangerous operation' }
  const approval = hitl.approvalWorkflow.requestApproval(action, 'test-user')
  const result = hitl.approvalWorkflow.approve(approval.id, 'admin', 'approved')
  return result.status === 'approved'
})

test('3.6 拒绝审批', () => {
  const hitl = createHitlSystem()
  const action = { type: 'financial_action', description: 'transfer money' }
  const approval = hitl.approvalWorkflow.requestApproval(action, 'test-user')
  const result = hitl.approvalWorkflow.reject(approval.id, 'admin', 'too risky')
  return result.status === 'rejected'
})

test('3.7 强制停止任务', () => {
  const hitl = createHitlSystem()
  const result = hitl.interventionController.forceStop('task-001', 'user interrupted', 'admin')
  return result.success && result.status === 'stopped'
})

test('3.8 修改任务参数', () => {
  const hitl = createHitlSystem()
  const result = hitl.interventionController.modifyTask('task-001', { priority: 'high' }, 'admin')
  return result.success && result.status === 'modified'
})

test('3.9 添加人类输入', () => {
  const hitl = createHitlSystem()
  const result = hitl.interventionController.addHumanInput('task-001', 'Please focus on accuracy', {})
  return result.success
})

test('3.10 获取统计信息', () => {
  const hitl = createHitlSystem()
  const stats = hitl.approvalWorkflow.getStats()
  return typeof stats.pendingCount === 'number'
})

// ------------------------------------------------------------
// Phase 4: 状态持久化测试
// ------------------------------------------------------------

log('info', '\n--- Phase 4: 状态持久化 ---')

test('4.1 创建检查点管理器', () => {
  const manager = createCheckpointManager()
  return manager instanceof Object
})

test('4.2 保存检查点', () => {
  const manager = createCheckpointManager()
  const result = manager.saveCheckpoint('task-001', { status: 'in_progress', progress: 50 })
  return result.checkpointId
})

test('4.3 恢复检查点', () => {
  const manager = createCheckpointManager()
  const saved = manager.saveCheckpoint('task-001', { status: 'completed', progress: 100 })
  const restored = manager.restoreCheckpoint(saved.checkpointId)
  return restored.state.status === 'completed'
})

test('4.4 列出检查点', () => {
  const manager = createCheckpointManager()
  manager.saveCheckpoint('task-001', { step: 1 })
  manager.saveCheckpoint('task-001', { step: 2 })
  const list = manager.listCheckpoints('task-001')
  return list.length >= 2
})

test('4.5 保存任务进度', () => {
  const manager = createCheckpointManager()
  const result = manager.saveProgress('task-001', 50, ['step1-done', 'step2-in-progress'])
  return result.checkpointId
})

test('4.6 保存任务完成', () => {
  const manager = createCheckpointManager()
  const result = manager.saveCompletion('task-001', { output: 'success' })
  return result.checkpointId
})

test('4.7 保存任务失败', () => {
  const manager = createCheckpointManager()
  const result = manager.saveFailure('task-001', new Error('Something went wrong'))
  return result.checkpointId
})

test('4.8 任务进度追踪器', () => {
  const manager = createCheckpointManager()
  const tracker = new TaskProgressTracker(manager, 'task-001')
  tracker.start(3)
  tracker.completeStep(0, { result: 'step1' })
  tracker.completeStep(1, { result: 'step2' })
  tracker.complete({ finalResult: 'done' })
  const status = tracker.getStatus()
  return status.currentStep === 2
})

test('4.9 获取存储统计', () => {
  const manager = createCheckpointManager()
  const stats = manager.getStats()
  return typeof stats.isMemoryOnly === 'boolean'
})

// ------------------------------------------------------------
// Phase 5: A2A 协议测试
// ------------------------------------------------------------

log('info', '\n--- Phase 5: A2A 协议 ---')

test('5.1 创建 A2A Server', () => {
  const server = createA2AServer({ port: 3101 })
  return server instanceof Object
})

test('5.2 Agent Card 结构正确', () => {
  const server = createA2AServer({ port: 3102 })
  return server.agentCard.name === 'Gina' && 
         server.agentCard.skills.length >= 3
})

test('5.3 技能列表包含知识查询', () => {
  const server = createA2AServer({ port: 3103 })
  return server.agentCard.skills.some(s => s.id === 'knowledge_query')
})

test('5.4 技能列表包含研究分析', () => {
  const server = createA2AServer({ port: 3104 })
  return server.agentCard.skills.some(s => s.id === 'research')
})

test('5.5 创建 A2A Client', () => {
  const client = createA2AClient()
  return client instanceof Object
})

test('5.6 已知 Agent 列表为空', () => {
  const client = createA2AClient()
  const list = client.listKnownAgents()
  return list.length === 0
})

test('5.7 任务类型推断', () => {
  const server = createA2AServer({ port: 3105 })
  return server.inferTaskType('search for information') === 'knowledge_query'
      && server.inferTaskType('analyze this data') === 'research'
      && server.inferTaskType('make a decision') === 'decision'
})

// ------------------------------------------------------------
// Phase 6: 集成测试
// ------------------------------------------------------------

log('info', '\n--- Phase 6: 集成测试 ---')

// 6.1 HITL + 状态持久化集成
test('6.1 HITL 与持久化集成', () => {
  const hitl = createHitlSystem()
  const checkpointManager = createCheckpointManager()
  
  // 模拟任务执行流程
  const taskId = 'integration-task-001'
  checkpointManager.saveCheckpoint(taskId, { status: 'started' })
  
  // 检查是否需要审批
  const action = { type: 'high_risk', description: 'dangerous operation' }
  const needsApproval = hitl.approvalWorkflow.needsApproval(action)
  
  // 如果需要审批，提交审批
  if (needsApproval) {
    const approval = hitl.approvalWorkflow.requestApproval(action, 'gina')
    hitl.approvalWorkflow.approve(approval.id, 'admin')
  }
  
  checkpointManager.saveCheckpoint(taskId, { status: 'completed', approved: true })
  
  const list = checkpointManager.listCheckpoints(taskId)
  return list.length >= 2
})

// 6.2 MCP + A2A 能力交叉验证
test('6.2 MCP 与 A2A 能力一致性', () => {
  const mcpServer = createGinaMcpServer({ handlers: ginaHandlers })
  const a2aServer = createA2AServer({ port: 3106 })
  
  const mcpTools = mcpServer.registerGinaTools().map(t => t.name)
  const a2aSkills = a2aServer.agentCard.skills.map(s => s.id)
  
  // 检查核心能力在两个协议中都有体现
  const hasKnowledge = mcpTools.some(t => t.includes('knowledge')) && 
                       a2aSkills.some(s => s.includes('knowledge'))
  const hasResearch = mcpTools.some(t => t.includes('research')) && 
                      a2aSkills.some(s => s.includes('research'))
  const hasDecision = mcpTools.some(t => t.includes('decision')) && 
                      a2aSkills.some(s => s.includes('decision'))
  
  return hasKnowledge && hasResearch && hasDecision
})

// 6.3 完整任务流程模拟
test('6.3 完整任务流程模拟', () => {
  const hitl = createHitlSystem()
  const checkpointManager = createCheckpointManager()
  const taskId = 'full-flow-task-001'
  
  // Step 1: 任务开始
  checkpointManager.saveCheckpoint(taskId, { 
    status: 'started', 
    step: 0, 
    totalSteps: 3 
  })
  
  // Step 2: 执行需要审批的操作
  const riskyAction = { type: 'high_risk', description: 'delete temporary files' }
  if (hitl.approvalWorkflow.needsApproval(riskyAction)) {
    const approval = hitl.approvalWorkflow.requestApproval(riskyAction, 'gina')
    hitl.approvalWorkflow.approve(approval.id, 'admin', 'necessary for cleanup')
  }
  
  checkpointManager.saveCheckpoint(taskId, { 
    status: 'in_progress', 
    step: 1, 
    approved: true 
  })
  
  // Step 3: 用户干预修改任务
  hitl.interventionController.modifyTask(taskId, { addStep: 'validation' }, 'admin')
  
  checkpointManager.saveCheckpoint(taskId, { 
    status: 'modified', 
    step: 1,
    modifications: ['added validation step']
  })
  
  // Step 4: 任务完成
  checkpointManager.saveCheckpoint(taskId, { 
    status: 'completed', 
    step: 3, 
    result: { success: true, modifications: 'accepted' }
  })
  
  const history = checkpointManager.listCheckpoints(taskId)
  const approvalStats = hitl.approvalWorkflow.getStats()
  
  return history.length >= 4 && approvalStats.pendingCount === 0
})

// ------------------------------------------------------------
// 测试结果输出
// ------------------------------------------------------------

setTimeout(() => {
  console.log('\n============================================================')
  console.log('  测试结果汇总')
  console.log('============================================================\n')
  
  console.log(`  总测试数: ${results.total}`)
  console.log(`  通过: ${results.passed} / ${results.total} (${(results.passed / results.total * 100).toFixed(1)}%)`)
  console.log(`  失败: ${results.failed}`)
  console.log(`  跳过: ${results.skipped}`)
  
  if (results.failed > 0) {
    console.log('\n  失败详情:')
    for (const detail of results.details) {
      if (detail.status === 'failed') {
        console.log(`    - ${detail.name}: ${detail.reason}`)
      }
    }
  }
  
  console.log('\n============================================================')
  if (results.failed === 0) {
    console.log('  🎉 所有测试通过！')
  } else {
    console.log(`  ⚠️  ${results.failed} 个测试失败，请查看详情`)
  }
  console.log('============================================================\n')
  
  // 输出模块统计
  console.log('  模块验证状态:')
  console.log('    ✅ MCP Server: 5 个测试')
  console.log('    ✅ MCP Client Manager: 5 个测试')
  console.log('    ✅ HITL 人机协作: 10 个测试')
  console.log('    ✅ 状态持久化: 9 个测试')
  console.log('    ✅ A2A 协议: 7 个测试')
  console.log('    ✅ 集成测试: 3 个测试')
  console.log('')
  
  process.exit(results.failed > 0 ? 1 : 0)
}, 2000)
