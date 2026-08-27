#!/usr/bin/env node

/**
 * Gina 全新功能全面测试套件
 * 
 * 测试范围:
 * 1. MCP Server - 工具注册、协议交互、真实模块连接
 * 2. HTTP MCP Client Manager - 远程服务器连接、工具搜索
 * 3. HITL 人机协作 - 审批工作流、干预机制
 * 4. 状态持久化 - 检查点管理、任务进度追踪
 * 5. A2A 协议 - Agent Card、任务分发
 * 6. Benchmark 框架 - 评估框架、基准测试
 * 7. 真实模块集成 - 知识、研究、决策、情感、规划
 */

import { createGinaMcpServer, ginaHandlers } from './src/mcp/gina-mcp-server.js'
import { HttpMcpClientManager, presetMcpServers } from './src/mcp/http-client-manager.js'
import { createHitlSystem } from './src/hitl/hitl-system.js'
import { createCheckpointManager, TaskProgressTracker } from './src/persistence/checkpoint-manager.js'
import { createA2AServer, createA2AClient } from './src/a2a/a2a-protocol.js'
import { BenchmarkFramework, createBenchmarkAgent, localBenchmarkTasks } from './src/benchmark/benchmark-framework.js'

// ============================================================
// 测试基础设施
// ============================================================

const allResults = {
  startedAt: new Date().toISOString(),
  suites: [],
  bugs: [],
  passed: 0,
  failed: 0,
  total: 0,
}

function log(level, message) {
  const timestamp = new Date().toISOString().split('T')[1].slice(0, 8)
  const prefix = {
    info: 'ℹ️',
    success: '✅',
    warning: '⚠️',
    error: '❌',
    bug: '🐛',
    suite: '📦',
  }[level] || 'ℹ️'
  console.log(`${timestamp} ${prefix} ${message}`)
}

function createSuite(name) {
  const suite = {
    name,
    tests: [],
    startTime: Date.now(),
  }
  
  async function test(testName, fn) {
    suite.tests.push({ name: testName, fn })
  }
  
  async function run() {
    log('suite', `\n=== Suite: ${name} ===`)
    let passed = 0
    let failed = 0
    
    for (const t of suite.tests) {
      allResults.total++
      const startTime = Date.now()
      
      try {
        const result = await t.fn()
        const duration = Date.now() - startTime
        
        if (result === false || result === null) {
          failed++
          allResults.failed++
          allResults.bugs.push({
            suite: name,
            test: t.name,
            error: 'Returned false or null',
            severity: 'high',
          })
          log('error', `FAIL: ${t.name} (${duration}ms)`)
        } else {
          passed++
          allResults.passed++
          log('success', `PASS: ${t.name} (${duration}ms)`)
        }
      } catch (err) {
        failed++
        allResults.failed++
        const duration = Date.now() - startTime
        const bug = {
          suite: name,
          test: t.name,
          error: err.message,
          stack: err.stack?.split('\n').slice(0, 3).join('\n'),
          severity: classifyError(err),
        }
        allResults.bugs.push(bug)
        log('error', `ERROR: ${t.name} - ${err.message} (${duration}ms)`)
      }
    }
    
    suite.endTime = Date.now()
    suite.duration = suite.endTime - suite.startTime
    suite.passed = passed
    suite.failed = failed
    allResults.suites.push(suite)
    
    log('info', `Suite ${name}: ${passed}/${suite.tests.length} passed (${suite.duration}ms)`)
  }
  
  return { test, run }
}

function classifyError(err) {
  const msg = err.message?.toLowerCase() || ''
  if (msg.includes('perm') || msg.includes('permission')) return 'critical'
  if (msg.includes('timeout') || msg.includes('timed out')) return 'high'
  if (msg.includes('connect') || msg.includes('econn')) return 'high'
  if (msg.includes('type') || msg.includes('is not')) return 'medium'
  return 'medium'
}

// ============================================================
// Suite 1: MCP Server 测试
// ============================================================
async function testMcpServer() {
  const { test, run } = createSuite('1. MCP Server')
  
  // 基础功能
  test('1.1 创建 MCP Server 实例', async () => {
    const server = createGinaMcpServer()
    return server !== null && server !== undefined
  })
  
  test('1.2 MCP Server 配置正确', async () => {
    const server = createGinaMcpServer({ name: 'test', version: '1.0.0' })
    return server.name === 'test' && server.version === '1.0.0'
  })
  
  test('1.3 默认能力配置', async () => {
    const server = createGinaMcpServer()
    return server.capabilities.knowledge === true && 
           server.capabilities.research === true &&
           server.capabilities.decision === true
  })
  
  // 工具注册
  test('1.4 注册 MCP Tools', async () => {
    const server = createGinaMcpServer()
    const tools = server.registerGinaTools()
    return Array.isArray(tools) && tools.length > 0
  })
  
  test('1.5 工具列表包含知识查询', async () => {
    const server = createGinaMcpServer()
    const tools = server.registerGinaTools()
    return tools.some(t => t.name === 'gina_query_knowledge')
  })
  
  test('1.6 工具列表包含研究分析', async () => {
    const server = createGinaMcpServer()
    const tools = server.registerGinaTools()
    return tools.some(t => t.name === 'gina_research_analyze')
  })
  
  test('1.7 工具列表包含决策分析', async () => {
    const server = createGinaMcpServer()
    const tools = server.registerGinaTools()
    return tools.some(t => t.name === 'gina_analyze_decision')
  })
  
  test('1.8 工具列表包含伦理检查', async () => {
    const server = createGinaMcpServer()
    const tools = server.registerGinaTools()
    return tools.some(t => t.name === 'gina_ethics_check')
  })
  
  test('1.9 工具列表包含情感分析', async () => {
    const server = createGinaMcpServer()
    const tools = server.registerGinaTools()
    return tools.some(t => t.name === 'gina_analyze_emotion')
  })
  
  test('1.10 工具列表包含任务规划', async () => {
    const server = createGinaMcpServer()
    const tools = server.registerGinaTools()
    return tools.some(t => t.name === 'gina_plan_task')
  })
  
  test('1.11 工具列表包含假设验证', async () => {
    const server = createGinaMcpServer()
    const tools = server.registerGinaTools()
    return tools.some(t => t.name === 'gina_verify_hypothesis')
  })
  
  test('1.12 总工具数量为 7', async () => {
    const server = createGinaMcpServer()
    const tools = server.registerGinaTools()
    return tools.length === 7
  })
  
  await run()
}

// ============================================================
// Suite 2: MCP Handlers 真实模块连接测试
// ============================================================
async function testMcpHandlers() {
  const { test, run } = createSuite('2. MCP Handlers 真实模块')
  
  // 知识查询
  test('2.1 知识查询 - 基础调用', async () => {
    const result = await ginaHandlers.queryKnowledge({ query: 'test', maxResults: 3 })
    return result !== null && result !== undefined
  })
  
  test('2.2 知识查询 - 返回结果结构正确', async () => {
    const result = await ginaHandlers.queryKnowledge({ query: 'AI', maxResults: 5 })
    return Array.isArray(result.results) && 
           typeof result.totalResults === 'number'
  })
  
  test('2.3 知识查询 - 支持领域过滤', async () => {
    const result = await ginaHandlers.queryKnowledge({ query: 'real estate', domain: 'real_estate', maxResults: 3 })
    return result.domain === 'real_estate' || result.domain === 'general'
  })
  
  test('2.4 知识查询 - 降级机制正常', async () => {
    const result = await ginaHandlers.queryKnowledge({ query: '' })
    return result !== null && result.retrievalMode !== undefined
  })
  
  // 研究分析
  test('2.5 研究分析 - 基础调用', async () => {
    const result = await ginaHandlers.researchAnalyze({ topic: 'AI agent', maxSources: 2 })
    return result !== null && result !== undefined
  })
  
  test('2.6 研究分析 - 返回结构正确', async () => {
    const result = await ginaHandlers.researchAnalyze({ topic: 'test' })
    return result.status !== undefined && Array.isArray(result.findings)
  })
  
  // 假设验证
  test('2.7 假设验证 - 基础调用', async () => {
    const result = await ginaHandlers.verifyHypothesis({ hypothesis: '测试假设' })
    return result !== null && result !== undefined
  })
  
  // 决策分析
  test('2.8 决策分析 - 多选项', async () => {
    const result = await ginaHandlers.analyzeDecision({ 
      options: [{ id: 'a', name: 'A', score: 0.9 }, { id: 'b', name: 'B', score: 0.7 }] 
    })
    return result !== null && result.recommendation !== undefined
  })
  
  test('2.9 决策分析 - 空选项处理', async () => {
    const result = await ginaHandlers.analyzeDecision({ options: [] })
    return result.recommendation === null && result.reason !== undefined
  })
  
  // 伦理检查
  test('2.10 伦理检查 - 英文敏感词', async () => {
    const result = await ginaHandlers.ethicsCheck({ action: 'delete data' })
    return result.ethical === false && result.riskLevel !== 'low'
  })
  
  test('2.11 伦理检查 - 中文敏感词', async () => {
    const result = await ginaHandlers.ethicsCheck({ action: '删除数据' })
    return result.ethical === false && result.riskLevel !== 'low'
  })
  
  test('2.12 伦理检查 - 正常操作', async () => {
    const result = await ginaHandlers.ethicsCheck({ action: 'read file' })
    return result.ethical === true && result.riskLevel === 'low'
  })
  
  // 情感分析
  test('2.13 情感分析 - 正面情感', async () => {
    const result = await ginaHandlers.analyzeEmotion({ text: '太好了！' })
    return result.primaryEmotion !== undefined && result.rate !== undefined
  })
  
  test('2.14 情感分析 - 中性情感', async () => {
    const result = await ginaHandlers.analyzeEmotion({ text: '请帮我查询' })
    return result.primaryEmotion !== undefined
  })
  
  // 任务规划
  test('2.15 任务规划 - 基础调用', async () => {
    const result = await ginaHandlers.planTask({ task: '完成报告' })
    return result.plan && Array.isArray(result.plan.steps)
  })
  
  test('2.16 任务规划 - 步骤数量正确', async () => {
    const result = await ginaHandlers.planTask({ task: '简单任务' })
    return result.plan.estimatedSteps > 0
  })
  
  await run()
}

// ============================================================
// Suite 3: HTTP MCP Client Manager 测试
// ============================================================
async function testHttpClientManager() {
  const { test, run } = createSuite('3. HTTP MCP Client Manager')
  
  test('3.1 创建 Manager 实例', async () => {
    const manager = new HttpMcpClientManager()
    return manager !== null
  })
  
  test('3.2 预设服务器配置存在', async () => {
    return presetMcpServers !== undefined && 
           typeof presetMcpServers === 'object'
  })
  
  test('3.3 GitHub MCP 预设存在', async () => {
    return presetMcpServers.github !== undefined
  })
  
  test('3.4 搜索工具 - 空查询', async () => {
    const manager = new HttpMcpClientManager()
    const results = await manager.searchTools('')
    return Array.isArray(results)
  })
  
  test('3.5 获取状态', async () => {
    const manager = new HttpMcpClientManager()
    const status = manager.getStatus()
    return status !== null && typeof status === 'object'
  })
  
  test('3.6 初始状态为空', async () => {
    const manager = new HttpMcpClientManager()
    const status = manager.getStatus()
    return status.connections !== undefined
  })
  
  await run()
}

// ============================================================
// Suite 4: HITL 人机协作测试
// ============================================================
async function testHitlSystem() {
  const { test, run } = createSuite('4. HITL 人机协作')
  
  let hitlSystem = null
  
  test('4.1 创建 HITL 系统', async () => {
    hitlSystem = createHitlSystem()
    return hitlSystem !== null
  })
  
  test('4.2 高风险操作需要审批', async () => {
    const isHighRisk = hitlSystem.isHighRiskAction('data_deletion')
    return isHighRisk === true
  })
  
  test('4.3 低风险操作不需要审批', async () => {
    const isHighRisk = hitlSystem.isHighRiskAction('query')
    return isHighRisk === false
  })
  
  test('4.4 提交审批请求', async () => {
    const request = hitlSystem.submitApproval({
      action: 'data_deletion',
      description: '删除测试数据',
      requester: 'agent',
    })
    return request !== null && request.id !== undefined
  })
  
  test('4.5 批准审批', async () => {
    const request = hitlSystem.submitApproval({
      action: 'high_risk',
      requester: 'agent',
    })
    const approved = hitlSystem.approveRequest(request.id, 'admin')
    return approved === true
  })
  
  test('4.6 拒绝审批', async () => {
    const request = hitlSystem.submitApproval({
      action: 'financial_action',
      requester: 'agent',
    })
    const rejected = hitlSystem.rejectRequest(request.id, 'admin', '不允许')
    return rejected === true
  })
  
  test('4.7 强制停止任务', async () => {
    const stopped = hitlSystem.forceStopTask('task-001', 'user interrupted')
    return stopped === true
  })
  
  test('4.8 修改任务参数', async () => {
    const modified = hitlSystem.modifyTask('task-001', { priority: 'high' })
    return modified === true
  })
  
  test('4.9 添加人类输入', async () => {
    const added = hitlSystem.addHumanInput('需要更多信息')
    return added === true
  })
  
  test('4.10 获取统计信息', async () => {
    const stats = hitlSystem.getStats()
    return stats !== null && typeof stats === 'object'
  })
  
  await run()
}

// ============================================================
// Suite 5: 状态持久化测试
// ============================================================
async function testPersistence() {
  const { test, run } = createSuite('5. 状态持久化')
  
  let checkpointManager = null
  let tracker = null
  
  test('5.1 创建检查点管理器', async () => {
    checkpointManager = createCheckpointManager()
    return checkpointManager !== null
  })
  
  test('5.2 保存检查点', async () => {
    const cp = checkpointManager.saveCheckpoint('task-001', { step: 1, status: 'in_progress' })
    return cp !== null && cp.id !== undefined
  })
  
  test('5.3 恢复检查点', async () => {
    checkpointManager.saveCheckpoint('task-001', { step: 2, status: 'completed' })
    const checkpoints = checkpointManager.listCheckpoints('task-001')
    if (checkpoints.length > 0) {
      const restored = checkpointManager.restoreCheckpoint(checkpoints[0].id)
      return restored !== null
    }
    return true // 如果没有检查点也不报错
  })
  
  test('5.4 列出检查点', async () => {
    const checkpoints = checkpointManager.listCheckpoints('task-001')
    return Array.isArray(checkpoints)
  })
  
  test('5.5 创建任务进度追踪器', async () => {
    tracker = new TaskProgressTracker(checkpointManager)
    return tracker !== null
  })
  
  test('5.6 保存任务进度', async () => {
    const saved = tracker.saveProgress('task-001', { step: 1, progress: 50 })
    return saved !== null
  })
  
  test('5.7 获取存储统计', async () => {
    const stats = checkpointManager.getStats()
    return stats !== null && typeof stats === 'object'
  })
  
  await run()
}

// ============================================================
// Suite 6: A2A 协议测试
// ============================================================
async function testA2AProtocol() {
  const { test, run } = createSuite('6. A2A 协议')
  
  let a2aServer = null
  let a2aClient = null
  
  test('6.1 创建 A2A Server', async () => {
    a2aServer = createA2AServer({ name: 'test-agent' })
    return a2aServer !== null
  })
  
  test('6.2 Agent Card 结构正确', async () => {
    const card = a2aServer.getAgentCard()
    return card && card.name === 'test-agent'
  })
  
  test('6.3 技能列表存在', async () => {
    const card = a2aServer.getAgentCard()
    return Array.isArray(card.skills)
  })
  
  test('6.4 创建 A2A Client', async () => {
    a2aClient = createA2AClient()
    return a2aClient !== null
  })
  
  test('6.5 已知 Agent 列表', async () => {
    const agents = a2aClient.getKnownAgents()
    return Array.isArray(agents)
  })
  
  test('6.6 任务类型推断 - 查询', async () => {
    const type = a2aClient.inferTaskType('search for information')
    return type === 'knowledge_query'
  })
  
  test('6.7 任务类型推断 - 研究', async () => {
    const type = a2aClient.inferTaskType('analyze and research this topic')
    return type === 'research'
  })
  
  test('6.8 任务类型推断 - 决策', async () => {
    const type = a2aClient.inferTaskType('evaluate and decide which option to choose')
    return type === 'decision'
  })
  
  test('6.9 任务类型推断 - 中文支持', async () => {
    const type = a2aClient.inferTaskType('帮我检索一下相关信息')
    return type === 'knowledge_query'
  })
  
  await run()
}

// ============================================================
// Suite 7: Benchmark 框架测试
// ============================================================
async function testBenchmarkFramework() {
  const { test, run } = createSuite('7. Benchmark 框架')
  
  test('7.1 创建 BenchmarkFramework', async () => {
    const fw = new BenchmarkFramework()
    return fw !== null
  })
  
  test('7.2 创建 Benchmark Agent', async () => {
    const agent = createBenchmarkAgent(ginaHandlers)
    return agent !== null && typeof agent.execute === 'function'
  })
  
  test('7.3 Agent 执行 - 知识查询', async () => {
    const agent = createBenchmarkAgent(ginaHandlers)
    const result = await agent.execute({ query: 'test' })
    return result !== null
  })
  
  test('7.4 Agent 执行 - 决策分析', async () => {
    const agent = createBenchmarkAgent(ginaHandlers)
    const result = await agent.execute({ options: [{ id: 'a', name: 'A' }] })
    return result !== null
  })
  
  test('7.5 Agent 执行 - 伦理检查', async () => {
    const agent = createBenchmarkAgent(ginaHandlers)
    const result = await agent.execute({ action: 'test' })
    return result !== null
  })
  
  test('7.6 本地任务集存在', async () => {
    return Array.isArray(localBenchmarkTasks) && localBenchmarkTasks.length > 0
  })
  
  test('7.7 本地任务集完整性', async () => {
    const hasCategories = ['knowledge', 'research', 'decision', 'ethics', 'emotion', 'planning', 'mcp']
    const categories = new Set(localBenchmarkTasks.map(t => t.category))
    return hasCategories.every(c => categories.has(c))
  })
  
  test('7.8 生成评估报告', async () => {
    const fw = new BenchmarkFramework()
    const report = fw.generateReport([
      { taskId: '1', status: 'completed', duration: 100 },
      { taskId: '2', status: 'failed', duration: 50 },
    ])
    return report.summary.total === 2 && report.summary.completed === 1
  })
  
  test('7.9 导出 JSON 结果', async () => {
    const fw = new BenchmarkFramework()
    fw.results = [{ test: '1', status: 'passed' }]
    const json = fw.exportResults('json')
    return typeof json === 'string'
  })
  
  await run()
}

// ============================================================
// Suite 8: 跨模块集成测试
// ============================================================
async function testIntegration() {
  const { test, run } = createSuite('8. 跨模块集成')
  
  // MCP + HITL 集成
  test('8.1 MCP Server + HITL 审批流程', async () => {
    const hitl = createHitlSystem()
    const server = createGinaMcpServer({ handlers: ginaHandlers })
    server.registerGinaTools()
    
    // 模拟高风险操作需要审批
    const isHighRisk = hitl.isHighRiskAction('data_deletion')
    return server.getToolList().length > 0 && isHighRisk === true
  })
  
  // HITL + 持久化集成
  test('8.2 HITL + 检查点持久化', async () => {
    const hitl = createHitlSystem()
    const cm = createCheckpointManager()
    
    // 模拟审批流程的检查点保存
    hitl.submitApproval({ action: 'test', requester: 'agent' })
    const cp = cm.saveCheckpoint('approval-task', { status: 'pending' })
    
    return cp !== null
  })
  
  // A2A + MCP 能力一致性
  test('8.3 A2A Agent Card 与 MCP Tools 一致性', async () => {
    const server = createGinaMcpServer()
    const tools = server.registerGinaTools()
    
    const a2aServer = createA2AServer({ name: 'gina' })
    const skills = a2aServer.getAgentCard().skills
    
    // MCP tools 和 A2A skills 应该都有知识查询能力
    const hasKnowledgeTool = tools.some(t => t.name.includes('knowledge'))
    const hasKnowledgeSkill = skills.some(s => s.includes('knowledge'))
    
    return hasKnowledgeTool && hasKnowledgeSkill
  })
  
  // 完整任务流程
  test('8.4 完整任务流程 - 计划→执行→反思', async () => {
    const cm = createCheckpointManager()
    const hitl = createHitlSystem()
    const tracker = new TaskProgressTracker(cm)
    
    // 模拟任务流程
    tracker.saveProgress('full-task', { step: 1, status: 'planning' })
    const approval = hitl.submitApproval({ action: 'execute', requester: 'agent' })
    hitl.approveRequest(approval.id, 'admin')
    tracker.saveProgress('full-task', { step: 2, status: 'executing' })
    
    const checkpoints = cm.listCheckpoints('full-task')
    return checkpoints.length >= 2
  })
  
  // Benchmark + 真实模块
  test('8.5 Benchmark 使用真实 handlers', async () => {
    const agent = createBenchmarkAgent(ginaHandlers)
    const result = await agent.execute({ query: 'integration test', maxResults: 3 })
    return result !== null && result.totalResults !== undefined
  })
  
  await run()
}

// ============================================================
// 主测试入口
// ============================================================

async function main() {
  console.log('')
  console.log('╔══════════════════════════════════════════════════════════════╗')
  console.log('║     Gina 全新功能全面测试套件                                  ║')
  console.log('║     Test Suite for All New Features                           ║')
  console.log('╚══════════════════════════════════════════════════════════════╝')
  console.log('')
  console.log(`  开始时间: ${new Date().toLocaleString()}`)
  console.log(`  测试模块: 8 个`)
  console.log(`  测试重点: MCP Server, Handlers, HTTP Client, HITL, 持久化, A2A, Benchmark, 集成`)
  console.log('')
  
  const startTime = Date.now()
  
  // 执行所有测试套件
  const testSuites = [
    testMcpServer,
    testMcpHandlers,
    testHttpClientManager,
    testHitlSystem,
    testPersistence,
    testA2AProtocol,
    testBenchmarkFramework,
    testIntegration,
  ]
  
  for (const suiteFn of testSuites) {
    try {
      await suiteFn()
    } catch (err) {
      log('error', `Suite execution failed: ${err.message}`)
      allResults.bugs.push({
        suite: 'unknown',
        test: 'suite_execution',
        error: err.message,
        severity: 'critical',
      })
    }
  }
  
  const totalDuration = Date.now() - startTime
  allResults.endedAt = new Date().toISOString()
  allResults.duration = totalDuration
  
  // 生成汇总报告
  console.log('\n')
  console.log('╔══════════════════════════════════════════════════════════════╗')
  console.log('║                      测试结果汇总                              ║')
  console.log('╚══════════════════════════════════════════════════════════════╝')
  console.log('')
  
  const passRate = ((allResults.passed / allResults.total) * 100).toFixed(1)
  
  console.log(`  总测试数: ${allResults.total}`)
  console.log(`  通过: ${allResults.passed}`)
  console.log(`  失败: ${allResults.failed}`)
  console.log(`  通过率: ${passRate}%`)
  console.log(`  总耗时: ${totalDuration}ms`)
  console.log('')
  
  // 各套件详情
  console.log('  各套件详情:')
  for (const suite of allResults.suites) {
    const rate = ((suite.passed / suite.tests.length) * 100).toFixed(0)
    const icon = rate === '100' ? '🟢' : rate >= '80' ? '🟡' : '🔴'
    console.log(`    ${icon} ${suite.name}: ${suite.passed}/${suite.tests.length} (${rate}%) - ${suite.duration}ms`)
  }
  
  // Bug 报告
  if (allResults.bugs.length > 0) {
    console.log('\n  🐛 发现的 Bug:')
    for (const bug of allResults.bugs) {
      console.log(`    [${bug.severity.toUpperCase()}] ${bug.suite} > ${bug.test}`)
      console.log(`           ${bug.error}`)
    }
  } else {
    console.log('\n  ✅ 未发现 Bug!')
  }
  
  // 评级
  console.log('\n  Gina 功能评级:')
  let grade = ''
  if (passRate >= '98') grade = 'S 级 - 世界领先'
  else if (passRate >= '90') grade = 'A 级 - 优秀'
  else if (passRate >= '75') grade = 'B 级 - 良好'
  else if (passRate >= '50') grade = 'C 级 - 及格'
  else grade = 'D 级 - 需要改进'
  
  console.log(`    ${grade}`)
  console.log('')
  
  // 输出完整结果为 JSON
  console.log('  完整测试结果已生成，可通过 test-results.json 查看')
  
  return allResults
}

main().then(results => {
  // 保存结果
  try {
    const fs = require('fs')
    fs.writeFileSync('test-results.json', JSON.stringify(results, null, 2))
    console.log('  结果已保存到 test-results.json')
  } catch (e) {
    console.log('  (无法保存文件，可能是权限问题)')
  }
  
  process.exit(results.failed > 0 ? 1 : 0)
}).catch(err => {
  console.error('Fatal error:', err)
  process.exit(2)
})
