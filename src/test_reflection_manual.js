#!/usr/bin/env node
// 直接测试反思分析功能

import { getReflectionState, recordReflection, analyzeReflections, resetReflectionState } from './memory/reflection-executor.js'

async function test() {
  console.log('=== 重置反思状态 ===')
  await resetReflectionState()
  
  console.log('=== 添加测试反思 ===')
  const testCases = [
    { outcome: 'failure', note: 'LLM 调用失败：超时', source: 'turn', metrics: { error_rate: 1 } },
    { outcome: 'success', note: '成功回答了用户问题', source: 'turn', metrics: { learning: 0, efficiency: 1 } },
    { outcome: 'failure', note: '数据库查询错误', source: 'turn', metrics: { error_rate: 1 } },
    { outcome: 'neutral', note: '回答质量一般', source: 'turn', metrics: { efficiency: 0.5 } },
    { outcome: 'failure', note: 'API 返回错误码 500', source: 'turn', metrics: { error_rate: 1 } },
    { outcome: 'success', note: '代码修改建议被采纳', source: 'turn', metrics: { learning: 1, efficiency: 0.8 } },
  ]
  
  for (const tc of testCases) {
    await recordReflection(tc)
    console.log(`  添加: ${tc.outcome} - ${tc.note}`)
  }
  
  const state = await getReflectionState()
  console.log(`\n当前反思数: ${state.reflections.length}`)
  
  console.log('\n=== 触发分析 ===')
  const result = await analyzeReflections(10)
  console.log('分析结果:', JSON.stringify(result, null, 2).slice(0, 500))
  
  const finalState = await getReflectionState()
  console.log(`\n最终状态:`)
  console.log(`  模式数: ${finalState.patterns.length}`)
  console.log(`  分析次数: ${finalState.analysisCount}`)
  console.log(`  最后分析时间: ${finalState.last_analysis_at || '未分析'}`)
  
  if (finalState.patterns.length > 0) {
    console.log('\n检测到的模式:')
    for (const p of finalState.patterns) {
      console.log(`  - ${p.type}: ${p.description || p.summary || ''}`)
    }
  }
  
  console.log('\n测试完成!')
}

test().catch(err => {
  console.error('测试失败:', err)
  process.exit(1)
})
