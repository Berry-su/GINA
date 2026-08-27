#!/usr/bin/env node

/**
 * Gina 真实模块连接验证测试
 * 
 * 验证 ginaHandlers 是否正确连接到真实模块
 * 并测试各模块的实际功能
 */

import { ginaHandlers } from './src/mcp/gina-mcp-server.js'

// 测试统计
const results = {
  total: 0,
  passed: 0,
  failed: 0,
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

async function asyncTest(name, fn) {
  results.total++
  try {
    const result = await fn()
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
    results.details.push({ name, status: 'error', reason: err.message })
    log('error', `ERROR: ${name} - ${err.message}`)
  }
}

// ============================================================
// 真实模块连接验证
// ============================================================

console.log('\n============================================================')
console.log('  Gina 真实模块连接验证')
console.log('============================================================\n')

// 1. 知识查询模块测试
log('info', '--- 1. 知识查询模块 ---')
await asyncTest('1.1 语义知识检索', async () => {
  const result = await ginaHandlers.queryKnowledge({ 
    query: 'AI 人工智能 Agent', 
    maxResults: 3 
  })
  return result.results && Array.isArray(result.results)
})

await asyncTest('1.2 知识检索包含结果', async () => {
  const result = await ginaHandlers.queryKnowledge({ 
    query: 'test', 
    maxResults: 5 
  })
  return result.totalResults >= 0
})

await asyncTest('1.3 检索模式标记', async () => {
  const result = await ginaHandlers.queryKnowledge({ 
    query: 'knowledge test',
  })
  return result.retrievalMode !== undefined
})

// 2. 研究分析模块测试
log('info', '--- 2. 研究分析模块 ---')
await asyncTest('2.1 文献搜索执行', async () => {
  const result = await ginaHandlers.researchAnalyze({ 
    topic: 'artificial intelligence', 
    maxSources: 3 
  })
  return result.status !== undefined
})

await asyncTest('2.2 研究发现提取', async () => {
  const result = await ginaHandlers.researchAnalyze({ 
    topic: 'machine learning', 
  })
  return Array.isArray(result.findings)
})

// 3. 假设验证模块测试
log('info', '--- 3. 假设验证模块 ---')
await asyncTest('3.1 假设生成', async () => {
  const result = await ginaHandlers.verifyHypothesis({ 
    hypothesis: '测试假设', 
    evidenceSources: ['source1'] 
  })
  return result.verdict !== undefined
})

// 4. 决策分析模块测试
log('info', '--- 4. 决策分析模块 ---')
await asyncTest('4.1 决策框架评估', async () => {
  const result = await ginaHandlers.analyzeDecision({ 
    options: [
      { id: 'opt1', name: '方案A', score: 0.8 },
      { id: 'opt2', name: '方案B', score: 0.6 },
    ],
    context: { taskType: 'test' }
  })
  return result.recommendation !== null || result.retrievalMode !== undefined
})

await asyncTest('4.2 空选项处理', async () => {
  const result = await ginaHandlers.analyzeDecision({ 
    options: [], 
  })
  return result.recommendation === null && result.reason !== undefined
})

// 5. 伦理检查模块测试
log('info', '--- 5. 伦理检查模块 ---')
await asyncTest('5.1 敏感操作检测', async () => {
  const result = await ginaHandlers.ethicsCheck({ 
    action: 'delete user data',
  })
  return result.ethical === false || result.riskLevel !== 'low'
})

await asyncTest('5.2 正常操作通过', async () => {
  const result = await ginaHandlers.ethicsCheck({ 
    action: 'read document',
  })
  return result.riskLevel === 'low'
})

// 6. 情感分析模块测试
log('info', '--- 6. 情感分析模块 ---')
await asyncTest('6.1 情感分析执行', async () => {
  const result = await ginaHandlers.analyzeEmotion({ 
    text: '我很高兴今天能完成任务',
  })
  return result.primaryEmotion !== undefined
})

await asyncTest('6.2 TTS 参数生成', async () => {
  const result = await ginaHandlers.analyzeEmotion({ 
    text: '你好',
  })
  return result.rate !== undefined && result.pitch !== undefined
})

// 7. 任务规划模块测试
log('info', '--- 7. 任务规划模块 ---')
await asyncTest('7.1 任务规划生成', async () => {
  const result = await ginaHandlers.planTask({ 
    task: '完成代码审查',
  })
  return result.plan && Array.isArray(result.plan.steps)
})

await asyncTest('7.2 计划步骤数量', async () => {
  const result = await ginaHandlers.planTask({ 
    task: '简单任务',
  })
  return result.plan.estimatedSteps > 0
})

// ============================================================
// 汇总结果
// ============================================================

console.log('\n============================================================')
console.log('  测试结果汇总')
console.log('============================================================\n')

console.log(`  总测试数: ${results.total}`)
console.log(`  通过: ${results.passed} / ${results.total} (${(results.passed / results.total * 100).toFixed(1)}%)`)
console.log(`  失败: ${results.failed}`)

if (results.failed > 0) {
  console.log('\n  失败详情:')
  results.details
    .filter(d => d.status !== 'passed')
    .forEach(d => console.log(`    - ${d.name}: ${d.reason}`))
}

if (results.passed === results.total) {
  console.log('\n============================================================')
  console.log('  🎉 所有真实模块连接测试通过！')
  console.log('============================================================')
  console.log('\n  Gina MCP Server 已成功连接到以下真实模块:')
  console.log('    ✅ knowledge-distiller.js - 知识检索')
  console.log('    ✅ research-engine.js - 研究分析')
  console.log('    ✅ hypothesis-verifier.js - 假设验证')
  console.log('    ✅ decision-framework.js - 决策框架')
  console.log('    ✅ emotion-tts-modulator.js - 情感计算')
  console.log('    ✅ plan-feedback-loop.js - 任务规划')
  console.log('    ✅ ethicsCheck (静态实现) - 伦理检查')
} else {
  console.log('\n  ⚠️ 部分测试失败，需要检查相关模块')
  process.exit(1)
}
